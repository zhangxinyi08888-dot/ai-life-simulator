import assert from "node:assert/strict";
import { downloadPoster } from "./posterDownload";

const element = { nodeType: 1 } as HTMLElement;
const createdUrls: string[] = [];
const revokedUrls: string[] = [];
const clicked: string[] = [];

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalDocument = globalThis.document;

URL.createObjectURL = (blob: Blob) => {
  assert.equal(blob.type, "image/png");
  const url = `blob:test-${createdUrls.length}`;
  createdUrls.push(url);
  return url;
};
URL.revokeObjectURL = (url: string) => {
  revokedUrls.push(url);
};

(globalThis as any).document = {
  createElement(tagName: string) {
    assert.equal(tagName, "a");
    return {
      href: "",
      download: "",
      click() {
        clicked.push(this.download);
      }
    };
  }
};

await downloadPoster({
  element,
  fileName: "../人生终章",
  pixelRatio: 2,
  exporter: async (target, options) => {
    assert.equal(target, element);
    assert.equal(options.pixelRatio, 2);
    assert.equal(options.cacheBust, true);
    return "data:image/png;base64,SGVsbG8=";
  }
});

assert.deepEqual(clicked, ["人生终章.png"]);
assert.deepEqual(createdUrls, ["blob:test-0"]);
assert.deepEqual(revokedUrls, ["blob:test-0"]);

await assert.rejects(
  () => downloadPoster({
    element: null,
    fileName: "x.png",
    exporter: async () => "data:image/png;base64,SGVsbG8="
  }),
  /海报节点不存在/
);

URL.createObjectURL = originalCreateObjectURL;
URL.revokeObjectURL = originalRevokeObjectURL;
(globalThis as any).document = originalDocument;
