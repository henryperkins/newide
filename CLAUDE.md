# CLAUDE.md - Project Guide for agentic coding

## Commands
- **Run App**: `uvicorn main:app --reload`
- **Initialize DB**: `python init_db.py`
- **CSS Development**: `npm run dev` (watch mode)
- **Build CSS**: `npm run build:css` (once) or `npm run build` (production)
- **Install Dependencies**: `pip install -r requirements.txt` and `npm install`

## Environment Setup
- Create a `.env` file with the following required variables:
  - **Database**: `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`
  - **Azure OpenAI**: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT_NAME`
  - **Azure Inference**: `AZURE_INFERENCE_ENDPOINT`, `AZURE_INFERENCE_CREDENTIAL`, `AZURE_INFERENCE_DEPLOYMENT`
  - **JWT**: `JWT_SECRET`
  - **Azure Search** (optional): `AZURE_SEARCH_ENDPOINT`, `AZURE_SEARCH_KEY`
- See `config.py` for additional configurable settings and defaults

## Code Style Guidelines
- **Imports**: Group by standard lib → third-party → local app imports
- **Formatting**: 4-space indentation, 100 char line limit
- **Types**: Use type hints for function parameters and return values
- **Naming**: 
  - snake_case for variables, functions, methods
  - PascalCase for classes
  - ALL_CAPS for constants
- **Error Handling**: Use try/except blocks for expected exceptions, provide clear error messages
- **API Endpoints**: Follow REST principles, use consistent response formats
- **File Organization**: Keep related functionality in appropriate routers/services

## Project Structure
- FastAPI backend with Tailwind CSS frontend
- Follows service-oriented architecture pattern
- Routes in `/routers`, business logic in `/services`
- Changes to CSS require running CSS build commands