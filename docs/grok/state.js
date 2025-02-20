// state.js
let sessionId = null;
let lastUserMessage = null;
let serverCalculatedTimeout = null;
let modelName = window.modelName || '';

export function getSessionId() {
    return sessionId;
}

export function setSessionId(id) {
    sessionId = id;
}

export function getLastUserMessage() {
    return lastUserMessage;
}

export function setLastUserMessage(message) {
    lastUserMessage = message;
}

export function getServerCalculatedTimeout() {
    return serverCalculatedTimeout;
}

export function setServerCalculatedTimeout(timeout) {
    serverCalculatedTimeout = timeout;
}

export function getModelName() {
    return modelName;
}

export function setModelName(name) {
    modelName = name;
}