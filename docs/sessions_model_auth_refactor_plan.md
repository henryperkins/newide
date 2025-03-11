# Plan to Refactor Sessions, Model Association, and User Authentication

## Overview

This plan describes how to centralize session management, model switching, and user authentication/ownership under a single “SessionService” (or similarly named class). By extracting session creation/validation, model switching, and user ownership checks into one service, the code becomes more maintainable and consistent.

## Goals

1. Reduce duplication of session-related code across multiple routers (session.py, chat.py, config.py).
2. Provide a single, authoritative code path for creating, validating, and extending sessions.
3. Enforce user ownership for authenticated sessions, ensuring that only the session owner can modify or retrieve a session’s data.
4. Centralize model switching (i.e., updating session.last_model) so that concurrency checks, fallback models, or future constraints are defined in one place.
5. Limit or unify “auto-create” logic so that random session explosion is avoided.

## Architecture

1. **SessionService** (New or Extended):
   - Methods:
     a. create_session(db_session, user_id=None)
        - Handles new session creation, enforces rate limits, sets expiration, stores user ownership if it’s an authenticated session.
     b. validate_session(session_id, db_session, user_id=None, require_valid=False)
        - Checks that the session exists and is not expired.
        - If user_id is provided, confirm the session belongs to that user (or allow anonymous if no user_id).
        - If require_valid is True, raise HTTPException if session is invalid.
     c. extend_session(session_id, db_session)
        - Renews the session’s expiration time.
     d. switch_model(session_id, new_model, db_session, user_id=None)
        - Ensures the requested model is valid (checking ClientPool).
        - Updates session.last_model; commits changes to DB.
        - Calls any concurrency or rate limit checks if required.
     e. get_current_model(session_id, db_session)
        - Returns session.last_model or a fallback default.

2. **Ownership Binding**:
   - For user-authenticated routes, store a `user_id` field in the `Session` row.
   - During validation, if a session has `owner_id`, confirm the current user’s ID matches. If not, raise 403.
   - Anonymous sessions (owner_id = null) have fewer privileges (faster expiration, no personal data storage).

3. **Refactoring Steps**:

   ### session.py
   - Replace database queries in `create_session`, `get_current_session`, `refresh_session` with direct calls to SessionService.
   - Example:
     ```python
     @router.post("/create")
     async def create_session(db_session: AsyncSession = Depends(get_db_session)):
         new_session = await SessionService.create_session(db_session, user_id=<extracted_user>)
         return {...}
     ```
   - For updating session model (`/model` endpoint), call `SessionService.switch_model(session_id, new_model, db_session, user_id=...)`.

   ### chat.py
   - For SSE logic that auto-creates a session if none is found, call `SessionService.create_session(db_session, user_id=None)`.
   - Remove direct DB writes to session table.

   ### config.py
   - For switching models in `/models/switch` endpoints, call `SessionService.switch_model(...)` instead of manually setting `session.last_model`.

   ### session_utils.py
   - Potentially retire or reduce to a helper that only extracts the session ID from cookies/headers, leaving the real validation to SessionService.
   - Rate-limit checks can be moved into SessionService to unify logic.

4. **Model Switching**:
   - The single `SessionService.switch_model(session_id, new_model, db_session, user_id)` ensures:
     - The new model is recognized in `ClientPool`.
     - Ownership checks (if needed).
     - Consistent updating of `session.last_model`.

5. **Auto-Creation Policy**:
   - If we keep auto-creation in SSE or certain endpoints, always funnel it through `SessionService.create_session()`.
   - Consider rate-limiting auto-creates to avoid generating many ephemeral sessions.

6. **Testing & Validation**:
   - Unit Tests for SessionService methods:
     - create_session: ensures session is created with correct expiration, respects rate limits.
     - validate_session: checks expired sessions, invalid session IDs, user ownership.
     - switch_model: ensures the new model is valid, session last_model is updated.
   - Integration Tests:
     - Confirm `/session/create` calls SessionService correctly.
     - Check `/chat/sse` can auto-create or rejects if user not allowed.
     - Validate `/config/models/switch` calls SessionService.switch_model.

7. **Phase-by-Phase Rollout**:
   1. Implement SessionService (with placeholders).
   2. Migrate session.py endpoints to use SessionService calls.
   3. Update chat.py SSE to unify creation/validation in SessionService.
   4. Replace any direct DB calls in config.py that modify session.last_model.
   5. Final pass to remove or minimize session_utils if duplicated.

## Benefits

- **Consistency**: All session creation, validation, and model switching follow the same code paths.
- **Maintainability**: Any changes to session logic (expiration, concurrency, ownership) happen in one place.
- **Security**: Tying user ownership to sessions means fewer chances for accidentally exposing sessions to other users.
- **Scalability**: Future concurrency or rate-limit rules can be added once, inside SessionService.

## Summary

By refactoring to a dedicated SessionService and ensuring each router calls it for session creation, validation, and model switching, we achieve a more coherent and maintainable approach. Centralizing advanced logic (ownership checks, concurrency control, auto-creation constraints) in one location reduces duplication and ensures consistent behavior across the application.