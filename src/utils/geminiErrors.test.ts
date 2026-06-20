import assert from "node:assert/strict";
import { formatGeminiErrorForClient, selectMostActionableGeminiError } from "./geminiErrors";

const unsupportedLocationError = new Error(
  '{"error":{"code":400,"message":"User location is not supported for the API use.","status":"FAILED_PRECONDITION"}}'
);

const staleModelError = new Error(
  '{"error":{"code":404,"message":"models/gemini-1.5-flash is not found","status":"NOT_FOUND"}}'
);

const selected = selectMostActionableGeminiError([unsupportedLocationError, staleModelError]);
assert.equal(selected, unsupportedLocationError);

const clientError = formatGeminiErrorForClient(selected);
assert.equal(clientError.status, 400);
assert.equal(clientError.payload.error, "GEMINI_LOCATION_NOT_SUPPORTED");
assert.match(clientError.payload.message, /当前网络所在地暂不支持 Gemini API/);

