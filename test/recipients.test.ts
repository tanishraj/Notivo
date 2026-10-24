import { describe, expect, it } from "vitest";
import { mergeRecipients, splitRecipients } from "../portal/src/lib/recipients";

describe("recipient badges", () => {
  it("accepts pasted address lists and removes duplicates regardless of case", () => {
    expect(
      mergeRecipients(
        ["first@example.com"],
        "Second@example.com; first@EXAMPLE.com\nthird@example.com",
      ),
    ).toEqual(["first@example.com", "second@example.com", "third@example.com"]);
    expect(
      splitRecipients("first@example.com, second@example.com"),
    ).toHaveLength(2);
  });
  it("rejects invalid batches without discarding already selected addresses", () => {
    const selected = ["first@example.com"];
    expect(() =>
      mergeRecipients(selected, "second@example.com, not-an-email"),
    ).toThrow("not a valid email");
    expect(selected).toEqual(["first@example.com"]);
  });
  it("counts unique recipients toward the limit and rejects oversized addresses", () => {
    const selected = Array.from(
      { length: 20 },
      (_, i) => `reader${i}@example.com`,
    );
    expect(mergeRecipients(selected, "READER0@example.com")).toHaveLength(20);
    expect(() => mergeRecipients(selected, "another@example.com")).toThrow(
      "up to 20",
    );
    expect(() => mergeRecipients([], `${"x".repeat(255)}@example.com`)).toThrow(
      "not a valid email",
    );
  });
});
