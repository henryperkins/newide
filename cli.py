#!/usr/bin/env python3
"""
CLI mode for chat application - allows interactive conversations with models from terminal
"""
import asyncio
import argparse
import json
import os
import sys
from typing import Dict, Any, Optional
import uuid

# Import required application components
from clients import get_model_client
import config
from database import AsyncSessionLocal
from services.config_service import ConfigService
from services.chat_service import process_chat_message
from azure.ai.inference import ChatCompletionsClient


# Terminal colors for prettier output
class Colors:
    HEADER = "\033[95m"
    BLUE = "\033[94m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    ENDC = "\033[0m"
    BOLD = "\033[1m"
    UNDERLINE = "\033[4m"
    THINKING = "\033[38;5;242m"  # Gray for thinking process


async def main():
    """Main entry point for CLI chat application"""
    parser = argparse.ArgumentParser(
        description="Chat with AI models from the command line"
    )
    parser.add_argument(
        "--model",
        "-m",
        type=str,
        default="DeepSeek-R1",
        help="Model to use (DeepSeek-R1 or o1)",
    )
    parser.add_argument(
        "--session",
        "-s",
        type=str,
        default=None,
        help="Session ID to continue (default: generate new)",
    )
    parser.add_argument(
        "--no-history", action="store_true", help="Don't store conversation in database"
    )
    parser.add_argument(
        "--thinking",
        "-t",
        action="store_true",
        help="Show thinking process for DeepSeek-R1",
    )
    args = parser.parse_args()

    # Initialize session
    session_id = args.session if args.session else str(uuid.uuid4())
    print(f"{Colors.HEADER}Starting chat session {session_id}{Colors.ENDC}")
    print(f"{Colors.YELLOW}Model: {args.model}{Colors.ENDC}")
    print(f"{Colors.BLUE}Type 'exit' or 'quit' to end the conversation{Colors.ENDC}")
    print(f"{Colors.BLUE}Type 'switch:model_name' to switch models{Colors.ENDC}")

    # Create database session for config_service
    async with AsyncSessionLocal() as db:
        config_service = ConfigService(db)
        model_name = args.model

        while True:
            try:
                # Get user input
                user_message = input(f"\n{Colors.GREEN}You: {Colors.ENDC}")

                # Check for exit command
                if user_message.lower() in ["exit", "quit"]:
                    print(f"{Colors.YELLOW}Exiting chat session.{Colors.ENDC}")
                    break

                # Check for model switch command
                if user_message.lower().startswith("switch:"):
                    parts = user_message.split(":", 1)
                    if len(parts) > 1:
                        new_model = parts[1].strip()
                        model_configs = await config_service.get_model_configs()
                        if new_model in model_configs:
                            model_name = new_model
                            print(
                                f"{Colors.YELLOW}Switched to model: {model_name}{Colors.ENDC}"
                            )
                        else:
                            print(
                                f"{Colors.RED}Model '{new_model}' not found. Available models: {', '.join(model_configs.keys())}{Colors.ENDC}"
                            )
                        continue

                # Get client for current model
                client = await get_model_client(model_name)

                print(f"{Colors.BLUE}Assistant: {Colors.ENDC}", end="", flush=True)

                # Create a message
                message = {
                    "session_id": session_id,
                    "message": user_message,
                    "model": model_name,
                    "stream": False,
                }

                # Process message - reusing your existing service
                if not args.no_history:
                    # Create a ChatMessage object first - process_chat_message expects this
                    from pydantic_models import ChatMessage

                    chat_message = ChatMessage(
                        message=user_message,
                        session_id=session_id,
                        reasoning_effort="medium",  # Default reasoning effort
                        messages=[{"role": "user", "content": user_message}]
                    )

                    response = await process_chat_message(
                        chat_message,
                        db,
                        client,
                        model_name
                    )

                    content = response["choices"][0]["message"]["content"]
                else:
                    # Handle direct API calls with proper error handling
                    try:
                        client = await get_model_client(model_name)
                        # Create properly typed message objects
                        from azure.ai.inference.models import ChatMessage
                        messages = [ChatMessage(role="user", content=user_message)]

                        if config.is_deepseek_model(model_name):
                            if isinstance(client, ChatCompletionsClient):
                                # Azure client (sync)
                                response = client.complete(
                                    model=model_name,
                                    messages=messages,
                                    temperature=config.DEEPSEEK_R1_DEFAULT_TEMPERATURE,
                                    max_tokens=config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS
                                )
                                content = response.choices[0].message.content
                            else:
                                # OpenAI client (async)
                                response = await client.chat.completions.create(
                                    model=model_name,
                                    messages=messages,
                                    temperature=config.DEEPSEEK_R1_DEFAULT_TEMPERATURE,
                                    max_tokens=config.DEEPSEEK_R1_DEFAULT_MAX_TOKENS
                                )
                                content = response.choices[0].message.content

                        elif config.is_o_series_model(model_name):
                            response = await client.chat.completions.create(
                                model=model_name,
                                messages=messages,
                                max_completion_tokens=config.O_SERIES_DEFAULT_MAX_COMPLETION_TOKENS,
                                reasoning_effort="medium"
                            )
                            content = response.choices[0].message.content

                        else:
                            content = "(Unsupported model)"

                    except AttributeError as e:
                        print(f"{Colors.RED}Client API error: {str(e)}{Colors.ENDC}")
                        content = "(API compatibility error)"
                    except Exception as e:
                        print(f"{Colors.RED}Error: {str(e)}{Colors.ENDC}")
                        content = "(Processing error)"
                            
                    except AttributeError as e:
                        print(f"{Colors.RED}Client API incompatibility: {str(e)}{Colors.ENDC}")
                        print(f"{Colors.YELLOW}Debug info - Client type: {type(client)}{Colors.ENDC}")
                        
                        if isinstance(client, ChatCompletionsClient):
                            print(f"{Colors.YELLOW}Client is Azure AI Inference ChatCompletionsClient{Colors.ENDC}")
                        elif hasattr(client, "api_key"):
                            print(f"{Colors.YELLOW}Client appears to be an OpenAI client{Colors.ENDC}")
                        
                        raise

                if config.is_deepseek_model(model_name):
                    import re
                    think_regex = r"<think>([\s\S]*?)</think>"
                    matches = re.findall(think_regex, content)

                    if args.thinking and matches:
                        for match in matches:
                            print(f"\n{Colors.THINKING}[Thinking process]{Colors.ENDC}")
                            print(f"{Colors.THINKING}{match}{Colors.ENDC}\n")

                    # Remove thinking tags for display
                    content = re.sub(think_regex, "", content)

                print(content)

            except KeyboardInterrupt:
                print(
                    f"\n{Colors.YELLOW}Chat session interrupted. Exiting.{Colors.ENDC}"
                )
                break
            except Exception as e:
                print(f"{Colors.RED}Error: {str(e)}{Colors.ENDC}")
                continue

if __name__ == "__main__":
    asyncio.run(main())
