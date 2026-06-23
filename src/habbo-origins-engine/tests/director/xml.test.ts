import { describe, expect, it } from "vitest";
import { LINGO_VOID } from "../../src/director/values";
import { XmlNode, XmlParserInstance } from "../../src/director/xml";

describe("Director XML Parser Xtra", () => {
  it("parses release306-style element trees in Node", () => {
    const parser = new XmlParserInstance();
    const result = parser.parseString(`
      <figuredata>
        <!-- ignored -->
        <colors>
          <palette id="1">
            <color id="30" selectable="1">4C&amp;31</color>
            <color id="31" />
          </palette>
        </colors>
      </figuredata>
    `);

    expect(result).toBe(0);
    expect(parser.getError()).toBe(LINGO_VOID);
    const figureData = parser.root?.child.getAt(1) as XmlNode;
    const colors = figureData.child.getAt(1) as XmlNode;
    const palette = colors.child.getAt(1) as XmlNode;
    const color = palette.child.getAt(1) as XmlNode;
    const emptyColor = palette.child.getAt(2) as XmlNode;

    expect(figureData.name).toBe("figuredata");
    expect(palette.attributeName.items).toEqual(["id"]);
    expect(palette.attributeValue.items).toEqual(["1"]);
    expect(color.attributeName.items).toEqual(["id", "selectable"]);
    expect(color.attributeValue.items).toEqual(["30", "1"]);
    expect(color.text).toBe("4C&31");
    expect((color.child.getAt(1) as XmlNode).text).toBe("4C&31");
    expect(emptyColor.name).toBe("color");
    expect(emptyColor.child.count()).toBe(0);
  });
});
