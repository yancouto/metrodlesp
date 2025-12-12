import { describe, test, expect, beforeEach } from "vitest";
import {
  loadIncludeCPTM,
  saveIncludeCPTM,
  loadCptmPromptSeen,
  saveCptmPromptSeen,
} from "../state";

describe("CPTM settings persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("includeCPTM defaults to false and persists when saved", () => {
    expect(loadIncludeCPTM()).toBe(false);
    saveIncludeCPTM(true);
    expect(loadIncludeCPTM()).toBe(true);
    saveIncludeCPTM(false);
    expect(loadIncludeCPTM()).toBe(false);
  });

  test("CPTM prompt seen flag defaults to false and can be set", () => {
    expect(loadCptmPromptSeen()).toBe(false);
    saveCptmPromptSeen();
    expect(loadCptmPromptSeen()).toBe(true);
  });
});
