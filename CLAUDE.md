# CLAUDE.md - Project Guide for agentic coding

## Commands
- **Run App**: `uvicorn main:app --reload`
- **Initialize DB**: `python init_db.py`
- **CSS Development**: `npm run dev` (watch mode)
- **Build CSS**: `npm run build:css` (once) or `npm run build` (production)
- **Install Dependencies**: `pip install -r requirements.txt` and `npm install`
- **CSS Linting**: `npm run lint:css`
- **Tests**: `python MCP/sentry/test_direct.py` or `python MCP/sentry/test_sentry_mcp.py`
- **Verify Sentry MCP**: `source /home/azureuser/newide/venv/bin/activate && python /home/azureuser/newide/MCP/sentry/verify_mcp_install.py`

## Environment Setup
- Create a `.env` file with the following required variables:
  - **Database**: `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`
  - **Azure OpenAI**: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT_NAME`
  - **Azure Inference**: `AZURE_INFERENCE_ENDPOINT`, `AZURE_INFERENCE_CREDENTIAL`, `AZURE_INFERENCE_DEPLOYMENT`
  - **JWT**: `JWT_SECRET`
  - **Azure Search** (optional): `AZURE_SEARCH_ENDPOINT`, `AZURE_SEARCH_KEY`
  - **Sentry**: `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_PROFILES_SAMPLE_RATE`
- See `config.py` for additional configurable settings and defaults

## Code Style Guidelines
- **Imports**: Group by standard lib → third-party → local app imports, sorted within groups
- **Formatting**: 4-space indentation, 100 char line limit, docstrings with triple double quotes
- **Types**: Use type hints for function parameters and return values
- **Naming**: 
  - snake_case for variables, functions, methods
  - PascalCase for classes
  - ALL_CAPS for constants
  - Descriptive names for all identifiers
- **Error Handling**: Use try/except blocks for expected exceptions, provide clear error messages
- **API Endpoints**: Follow REST principles, use consistent response formats
- **Documentation**: Class docstrings explain purpose, function docstrings describe parameters/returns

## Project Structure
- FastAPI backend with Tailwind CSS frontend
- Follows service-oriented architecture pattern
- Routes in `/routers`, business logic in `/services`
- MCP/sentry contains independent test modules
- Changes to CSS require running CSS build commands

## Sentry Integration
- **Documentation**: See `/docs/Sentry/` directory for detailed guides:
  - `/docs/Sentry/SentryFastAPIOverview.md` - FastAPI integration overview
  - `/docs/Sentry/SentryTracingGuide.md` - Performance monitoring guide
  - `/docs/Sentry/PythonLoggingSentry.md` - Python logging integration
  - `/docs/Sentry/Porfiling.md` - Profiling guide
  - `/docs/Sentry/EnrichingEvents.md` - Adding context to events
  - `/docs/Sentry/SentryPythonIntegrations.md` - Python SDK integrations
  - `/docs/Sentry/javascriptguide.md` - Frontend integration
- **MCP Server**: Sentry MCP server is configured - see `/MCP/sentry/README.md`
- **Backend Usage**: Use `sentry_sdk.start_transaction()` for custom transactions and `@sentry_sdk.profile()` for function-level profiling
- **Spans**: Use `sentry_sdk.start_profiling_span()` for profiling code blocks within functions
- **Frontend**: Initialized in `static/js/sentryInit.js`
- **Test Endpoint**: Access `/sentry-test` to verify the integration works
- **Verification**: Run `python MCP/sentry/verify_mcp_install.py` to test installation