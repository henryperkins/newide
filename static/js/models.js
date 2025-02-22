export const MODEL_CONFIG = {
    "o1model-east2": {
        name: "o1model-east2",
        api_version: "2025-01-01-preview",
        capabilities: {
            supports_streaming: false,
            supports_vision: false,
            requires_reasoning_effort: true,
            max_completion_tokens: 40000,
            fixed_temperature: 1.0,
            token_cost_multiplier: 1.5
        },
        endpoint: "https://o1models.openai.azure.com",
        deployment_name: "o1model-east2",
        developer_message: "Formatting re-enabled - use markdown code blocks",
        safety_config: {
            content_filter: true,
            max_retries: 3,
            jailbreak_protection: true
        },
        response_format: {
            reasoning_tag_open: ""
        }
    },
    "deepseek-r1": {
        name: "deepseek-r1",
        api_version: "2024-05-01-preview",
        capabilities: {
            supports_streaming: true,
            supports_vision: false,
            requires_reasoning_effort: false,
            max_tokens: 4096,
            default_temperature: 0.7,
            token_cost_multiplier: 1.0
        },
        system_message: "You are a helpful assistant",
        response_format: {
            reasoning_tag_open: ""
        },
        safety_config: {
            content_filter: true,
            max_retries: 3,
            jailbreak_protection: true
        }
    }
};
