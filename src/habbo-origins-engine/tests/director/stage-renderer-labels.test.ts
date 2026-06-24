import { describe, expect, it } from "vitest";
import { userNameLabelZIndex } from "../../src/render/StageRenderer";

describe("Director stage username labels", () => {
  it("keeps labels in room-world z order instead of above source UI windows", () => {
    expect(userNameLabelZIndex(42)).toBe(43);
    expect(userNameLabelZIndex(-5)).toBe(1);
    expect(userNameLabelZIndex(150.4)).toBe(151);
  });
});
