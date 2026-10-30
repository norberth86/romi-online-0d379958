import { expect, it } from "vitest";
import { retainPreparation } from "./preparation";

it("keeps several preparations when an unrelated card is discarded", () => {
  expect(retainPreparation([["H3", "H4", "H5"], ["S9", "D9", "C9"]], ["H3", "H4", "H5", "S9", "D9", "C9"])).toEqual([["H3", "H4", "H5"], ["S9", "D9", "C9"]]);
});
it("removes only the missing card and retains the editable remainder", () => {
  expect(retainPreparation([["H3", "H4", "H5"], ["S9", "D9", "C9"]], ["H3", "H5", "S9", "D9", "C9"])).toEqual([["H3", "H5"], ["S9", "D9", "C9"]]);
});