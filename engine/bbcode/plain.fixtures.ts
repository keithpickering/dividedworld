/**
 * The plain-words fixtures: BBCode bodies and the plain words each should give, one list for two
 * languages ("Two lists that must agree are one list"). `plain` is `collapse(visibleText(parse(body)))`,
 * which engine/bbcode/plain.test.ts holds against the engine's walk (engine/bbcode/visible.ts over
 * engine/bbcode/parse.ts). tools/bbcode-plain.mjs makes supabase/tests/0117-bbcode-plain.sql from the
 * same list, which holds the database's `bbcode_plain` (supabase/migrations/0116_search.sql) to the
 * same words, and tools/check-bbcode-plain.mjs holds that file to exactly what the list makes.
 *
 * The list is JSON after the marker line below, so tools/bbcode-plain.mjs can read it without a
 * TypeScript loader; add a fixture by adding an object, then run `node tools/bbcode-plain.mjs`.
 * Whitespace is collapsed on both sides because a separator is only a word boundary to the index.
 */
export interface PlainFixture {
  readonly name: string;
  readonly body: string;
  readonly plain: string;
}

/** Each run of whitespace (tab to carriage return, and space) becomes one space, and the ends are trimmed. */
export const collapse = (s: string): string => s.replace(/[\t-\r ]+/g, ' ').replace(/^ | $/g, '');

export const PLAIN_FIXTURES: readonly PlainFixture[] = [
  {
    "name": "an empty body",
    "body": "",
    "plain": ""
  },
  {
    "name": "whitespace only",
    "body": "  \n\t ",
    "plain": ""
  },
  {
    "name": "plain text",
    "body": "Just some plain words, with punctuation! And numbers 42.",
    "plain": "Just some plain words, with punctuation! And numbers 42."
  },
  {
    "name": "bold keeps its words",
    "body": "ca[b]ts[/b] and dogs",
    "plain": "cats and dogs"
  },
  {
    "name": "italic keeps its words",
    "body": "an [i]italic[/i] word",
    "plain": "an italic word"
  },
  {
    "name": "underline keeps its words",
    "body": "an [u]underlined[/u] word",
    "plain": "an underlined word"
  },
  {
    "name": "strike keeps its words",
    "body": "a [s]struck[/s] word",
    "plain": "a struck word"
  },
  {
    "name": "color keeps its words",
    "body": "a [color=red]red[/color] and [color=#1A2b3C]hex[/color] word",
    "plain": "a red and hex word"
  },
  {
    "name": "size keeps its words",
    "body": "a [size=5]big[/size] word",
    "plain": "a big word"
  },
  {
    "name": "tag names ignore case",
    "body": "[B]loud[/B] and [Color=Red]red[/COLOR]",
    "plain": "loud and red"
  },
  {
    "name": "formatting nests",
    "body": "[b][i][u]all three[/u][/i][/b]",
    "plain": "all three"
  },
  {
    "name": "a bad color is text",
    "body": "[color=nope]x[/color] y",
    "plain": "[color=nope]x[/color] y"
  },
  {
    "name": "a bad size is text",
    "body": "[size=9]x[/size] [size=0]y[/size]",
    "plain": "[size=9]x[/size] [size=0]y[/size]"
  },
  {
    "name": "a tag with an attribute it does not take is text",
    "body": "[b=1]x[/b]",
    "plain": "[b=1]x[/b]"
  },
  {
    "name": "an unordered list",
    "body": "intro[list][*]one[*]two[/list]outro",
    "plain": "intro one two outro"
  },
  {
    "name": "an ordered list",
    "body": "x[list=1][*]one[*]two[/list]y",
    "plain": "x one two y"
  },
  {
    "name": "an empty list",
    "body": "x[list][/list]y",
    "plain": "x y"
  },
  {
    "name": "a list in a list",
    "body": "[list][*]a[list][*]x[/list][*]b[/list]",
    "plain": "a x b"
  },
  {
    "name": "words before the first item",
    "body": "[list]intro[*]a[/list]",
    "plain": "intro a"
  },
  {
    "name": "an item marker outside a list is text",
    "body": "a [*] b [b][*]x[/b]",
    "plain": "a [*] b [*]x"
  },
  {
    "name": "a list type other than 1 is text",
    "body": "[list=a][*]x[/list]",
    "plain": "[list=a][*]x[/list]"
  },
  {
    "name": "a quote leaves none of its words",
    "body": "before[quote=0f8fad5b-d9cb-469f-a165-70867728950e]cats in a quote[/quote]after",
    "plain": "before after"
  },
  {
    "name": "a quote in a quote",
    "body": "a[quote=0f8fad5b-d9cb-469f-a165-70867728950e]b[quote=0f8fad5b-d9cb-469f-a165-70867728950e]c[/quote]d[/quote]e",
    "plain": "a e"
  },
  {
    "name": "a quote with a name that is no Act is a counterfeit and keeps its words",
    "body": "[quote=zz]q[/quote] [quote]r[/quote]",
    "plain": "q r"
  },
  {
    "name": "a quote inside a list item",
    "body": "[list][*]a[quote=0f8fad5b-d9cb-469f-a165-70867728950e]q[/quote]b[/list]",
    "plain": "a b"
  },
  {
    "name": "code leaves none of its words",
    "body": "x[code]cats in code [b]b[/b][/code]y",
    "plain": "x y"
  },
  {
    "name": "code with no closing tag is text",
    "body": "x[code]cats [b]bold[/b]",
    "plain": "x[code]cats bold"
  },
  {
    "name": "code with an attribute is text",
    "body": "[code=x]a[/code] b",
    "plain": "[code=x]a[/code] b"
  },
  {
    "name": "a link with = leaves none of its words",
    "body": "x[url=https://a.example]cats link[/url]y",
    "plain": "x y"
  },
  {
    "name": "a link to a site path and to mail",
    "body": "a[url=/b/1]c[/url]d[url=mailto:a@b.example]e[/url]f",
    "plain": "a d f"
  },
  {
    "name": "a link without = and a good address",
    "body": "x[url]https://a.example/p?q=1[/url]y",
    "plain": "x y"
  },
  {
    "name": "a link without = and a bad address keeps its words",
    "body": "x[url]not a link[/url]y",
    "plain": "x[url]not a link[/url]y"
  },
  {
    "name": "a bare link left open falls back to its words",
    "body": "[url]https://example.com",
    "plain": "[url]https://example.com"
  },
  {
    "name": "a bare link around a tag keeps its words",
    "body": "[url]https://a.example/[b]x[/b][/url]",
    "plain": "[url]https://a.example/x[/url]"
  },
  {
    "name": "a link with a javascript target is text",
    "body": "[url=javascript:x]a[/url] b",
    "plain": "[url=javascript:x]a[/url] b"
  },
  {
    "name": "a link whose host has credentials is text",
    "body": "[url=https://mfgg.net@evil.example/]a[/url]",
    "plain": "[url=https://mfgg.net@evil.example/]a[/url]"
  },
  {
    "name": "a link with an invisible character is text",
    "body": "[url=https://a.example/​x]a[/url]",
    "plain": "[url=https://a.example/​x]a[/url]"
  },
  {
    "name": "a link with a long host is a link",
    "body": "[url=https://a-b.c.example:8080/x]a[/url]",
    "plain": ""
  },
  {
    "name": "a link opened inside a link closes the first",
    "body": "[url=https://a.example]one [url=https://b.example]two[/url]three[/url]four",
    "plain": "three[/url]four"
  },
  {
    "name": "a link left open before another link",
    "body": "[url]https://a.example [url=https://b.example]two[/url]",
    "plain": "[url]https://a.example"
  },
  {
    "name": "an image leaves no words",
    "body": "x[img]https://a.example/c.png[/img]y",
    "plain": "x y"
  },
  {
    "name": "an image with a data source is text",
    "body": "[img]data:text/html,x[/img] z",
    "plain": "[img]data:text/html,x[/img] z"
  },
  {
    "name": "an image with no closing tag is text",
    "body": "a [img]https://a.example/c.png b",
    "plain": "a [img]https://a.example/c.png b"
  },
  {
    "name": "an image with an attribute is text",
    "body": "[img=x]https://a.example/c.png[/img]",
    "plain": "[img=x]https://a.example/c.png[/img]"
  },
  {
    "name": "an image inside a link",
    "body": "[url=https://a.example]a[img]https://a.example/c.png[/img][/url]b",
    "plain": "b"
  },
  {
    "name": "an unclosed tag keeps its words",
    "body": "[b]loud [i]and slanted",
    "plain": "loud and slanted"
  },
  {
    "name": "an unknown tag is text",
    "body": "a [foo]b[/foo] c <b>d</b> [] e",
    "plain": "a [foo]b[/foo] c <b>d</b> [] e"
  },
  {
    "name": "an unknown closer is text",
    "body": "a [/code] b [/img] c [/*] d",
    "plain": "a [/code] b [/img] c [/*] d"
  },
  {
    "name": "a stray closing tag is text",
    "body": "x[/b]y [/quote] [/list]",
    "plain": "x[/b]y [/quote] [/list]"
  },
  {
    "name": "a badly nested tag closes the inner one",
    "body": "[b][i]x[/b]y[/i]",
    "plain": "xy[/i]"
  },
  {
    "name": "a closer reaching past an open list",
    "body": "[b][list][*]a[/b]z",
    "plain": "a z"
  },
  {
    "name": "an opener turned to text takes its closer",
    "body": "[b][color=nope]x[/color]y[/b]",
    "plain": "[color=nope]x[/color]y"
  },
  {
    "name": "brackets that are not tags",
    "body": "[[[b]]]a[/b]]] [ [b",
    "plain": "[[]]a]] [ [b"
  },
  {
    "name": "a tag past the nesting cap is text",
    "body": "[b][b][b][b][b][b][b][b][b][b][b][b][b][b][b][b][b][b][b][b][b][b][b][b][b][b][b][b][b][b][b][b][b][b]core[/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b][/b]",
    "plain": "[b][b]core[/b][/b]"
  },
  {
    "name": "a tag past the nesting cap with words between",
    "body": "[i][i][i][i][i][i][i][i][i][i][i][i][i][i][i][i][i][i][i][i][i][i][i][i][i][i][i][i][i][i][i][i][i]a[b]b[/b]c[/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i][/i]",
    "plain": "[i]a[b]b[/b]c[/i]"
  },
  {
    "name": "non-Latin text",
    "body": "ねこ [b]猫[/b] кошка [i]γάτα[/i] قطة",
    "plain": "ねこ 猫 кошка γάτα قطة"
  },
  {
    "name": "astral characters",
    "body": "a 🐱[b]🐶[/b] b",
    "plain": "a 🐱🐶 b"
  },
  {
    "name": "a long tag is text",
    "body": "[bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb] x",
    "plain": "[bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb] x"
  },
  {
    "name": "html is text",
    "body": "<script>alert(1)</script> &amp; [b]x[/b]",
    "plain": "<script>alert(1)</script> &amp; x"
  },
  {
    "name": "a code word against a longer tag name",
    "body": "[codex]a[/codex] [list2]b",
    "plain": "[codex]a[/codex] [list2]b"
  },
  {
    "name": "a bad character past a long run of spaces before an address",
    "body": "[url]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        http://a.example/[<[/url]",
    "plain": "[url] http://a.example/[<[/url]"
  },
  {
    "name": "a bad character past a long run of tabs before an address",
    "body": "[url]\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\thttp://a.example/[<[/url]",
    "plain": "[url] http://a.example/[<[/url]"
  },
  {
    "name": "a bad character past a long run of newlines before an address",
    "body": "[url]\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nhttp://a.example/[<[/url]",
    "plain": "[url] http://a.example/[<[/url]"
  },
  {
    "name": "a bad character past a long run of a mix of every trimmed blank before an address",
    "body": "[url]\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿\t\n\u000b\f\r                  　﻿http://a.example/[<[/url]",
    "plain": "[url]                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿                  　﻿http://a.example/[<[/url]"
  },
  {
    "name": "a bad character past a long run of no-break spaces before an address",
    "body": "[url]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        http://a.example/[<[/url]",
    "plain": "[url]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        http://a.example/[<[/url]"
  },
  {
    "name": "a bad character past a long run of ideographic spaces before an address",
    "body": "[url]　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　http://a.example/[<[/url]",
    "plain": "[url]　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　http://a.example/[<[/url]"
  },
  {
    "name": "a bad character past a long run of byte order marks before an address",
    "body": "[url]﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿http://a.example/[<[/url]",
    "plain": "[url]﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿http://a.example/[<[/url]"
  },
  {
    "name": "a bad character past a long run of line separators before an address",
    "body": "[url]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        http://a.example/[<[/url]",
    "plain": "[url]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        http://a.example/[<[/url]"
  },
  {
    "name": "a bad character past a long run of spaces before an address, with a text link after",
    "body": "[url]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        http://a.example/[<[/url] [url]http://b.example/[/url]",
    "plain": "[url] http://a.example/[<[/url]"
  },
  {
    "name": "a long run of spaces after an address, then more words",
    "body": "[url]http://a.example/                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        [x[/url]",
    "plain": "[url]http://a.example/ [x[/url]"
  },
  {
    "name": "a long run of tabs after an address, then more words",
    "body": "[url]http://a.example/\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t[x[/url]",
    "plain": "[url]http://a.example/ [x[/url]"
  },
  {
    "name": "a long run of spaces before an address with a bracket in its path is a link",
    "body": "[url]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        http://a.example/[x[/url]",
    "plain": ""
  },
  {
    "name": "an address over the limit behind blanks is not a link",
    "body": "[url]                                                                                                    http://a.example/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa[/url]",
    "plain": "[url] http://a.example/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa[/url]"
  },
  {
    "name": "an address at the limit behind blanks is a link",
    "body": "[url]\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nhttp://a.example/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa[/url]",
    "plain": ""
  },
  {
    "name": "an image behind a long run of spaces",
    "body": "[img]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        http://a.example/x[/img]",
    "plain": "[img] http://a.example/x[/img]"
  },
  {
    "name": "an image with a bad character behind a long run of spaces",
    "body": "[img]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        http://a.example/x\"[/img]",
    "plain": "[img] http://a.example/x\"[/img]"
  },
  {
    "name": "a counterfeit quote keeps its words",
    "body": "a[quote=Geno]b c[/quote]d",
    "plain": "ab cd"
  },
  {
    "name": "a bare quote is a counterfeit and keeps its words",
    "body": "[quote]r[/quote]",
    "plain": "r"
  },
  {
    "name": "a quote with only user= is a counterfeit",
    "body": "[quote user=0f8fad5b-d9cb-469f-a165-70867728950e]hi there[/quote]",
    "plain": "hi there"
  },
  {
    "name": "a counterfeit with a quoted name and user=",
    "body": "[quote=\"Geno Wario\" user=0f8fad5b-d9cb-469f-a165-70867728950e]x y[/quote]",
    "plain": "x y"
  },
  {
    "name": "a counterfeit with a name and user=",
    "body": "[quote=Geno Wario user=6ba7b810-9dad-11d1-80b4-00c04fd430c8]x y[/quote]",
    "plain": "x y"
  },
  {
    "name": "an Act id with another id as user= is a real quote",
    "body": "a[quote=0f8fad5b-d9cb-469f-a165-70867728950e user=6ba7b810-9dad-11d1-80b4-00c04fd430c8]gone[/quote]b",
    "plain": "a b"
  },
  {
    "name": "an Act id with USER= in capitals is a real quote",
    "body": "a[quote=0F8FAD5B-D9CB-469F-A165-70867728950E USER=6BA7B810-9DAD-11D1-80B4-00C04FD430C8]gone[/quote]b",
    "plain": "a b"
  },
  {
    "name": "a quote with user= and a second equals sign is text",
    "body": "[quote user=0f8fad5b-d9cb-469f-a165-70867728950e=6ba7b810-9dad-11d1-80b4-00c04fd430c8]x[/quote]",
    "plain": "[quote user=0f8fad5b-d9cb-469f-a165-70867728950e=6ba7b810-9dad-11d1-80b4-00c04fd430c8]x[/quote]"
  },
  {
    "name": "a quote name of 80 characters is a counterfeit",
    "body": "[quote=nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn]kept[/quote]",
    "plain": "kept"
  },
  {
    "name": "a quote name of 81 characters is text",
    "body": "[quote=nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn]kept[/quote]",
    "plain": "[quote=nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn]kept[/quote]"
  },
  {
    "name": "a quote name of 80 units with astral characters is a counterfeit",
    "body": "[quote=😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀]kept[/quote]",
    "plain": "kept"
  },
  {
    "name": "a quote name of 82 units with astral characters is text",
    "body": "[quote=😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀]kept[/quote]",
    "plain": "[quote=😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀]kept[/quote]"
  },
  {
    "name": "a quote with a bad user= makes the opener and its closer text",
    "body": "[quote=Geno user=zz]a[/quote]",
    "plain": "[quote=Geno user=zz]a[/quote]"
  },
  {
    "name": "a quote with user= and a trailing blank is text",
    "body": "[quote=Geno user=0f8fad5b-d9cb-469f-a165-70867728950e ]a[/quote]",
    "plain": "[quote=Geno user=0f8fad5b-d9cb-469f-a165-70867728950e ]a[/quote]"
  },
  {
    "name": "a quote with a tab before user=",
    "body": "[quote=Geno\tuser=0f8fad5b-d9cb-469f-a165-70867728950e]a[/quote]",
    "plain": "a"
  },
  {
    "name": "a quote with a no-break space before user=",
    "body": "[quote=Geno user=0f8fad5b-d9cb-469f-a165-70867728950e]a[/quote]",
    "plain": "a"
  },
  {
    "name": "a quote with two user= is text",
    "body": "[quote=Geno user=x user=0f8fad5b-d9cb-469f-a165-70867728950e]a[/quote]",
    "plain": "[quote=Geno user=x user=0f8fad5b-d9cb-469f-a165-70867728950e]a[/quote]"
  },
  {
    "name": "a quote with an empty name is text",
    "body": "[quote=]a[/quote] [quote= ]b[/quote] [quote=\"\"]c[/quote]",
    "plain": "[quote=]a[/quote] [quote= ]b[/quote] [quote=\"\"]c[/quote]"
  },
  {
    "name": "a quote with an unterminated quoted name is text",
    "body": "[quote=\"Geno]a[/quote]",
    "plain": "[quote=\"Geno]a[/quote]"
  },
  {
    "name": "a quote with text after its quoted name is text",
    "body": "[quote=\"Geno\"x]a[/quote]",
    "plain": "[quote=\"Geno\"x]a[/quote]"
  },
  {
    "name": "a quote name holding an equals sign",
    "body": "[quote=a=b]kept[/quote]",
    "plain": "kept"
  },
  {
    "name": "QUOTE in capitals",
    "body": "[QUOTE=Geno]kept[/QUOTE]",
    "plain": "kept"
  },
  {
    "name": "quotex is no tag",
    "body": "[quotex]a[/quotex]",
    "plain": "[quotex]a[/quotex]"
  },
  {
    "name": "a counterfeit in a counterfeit",
    "body": "[quote=a]x[quote=b]y[/quote]z[/quote]",
    "plain": "xyz"
  },
  {
    "name": "a real quote in a counterfeit",
    "body": "[quote=a]x[quote=0f8fad5b-d9cb-469f-a165-70867728950e]gone[/quote]z[/quote]",
    "plain": "x z"
  },
  {
    "name": "a counterfeit in a real quote is dropped with it",
    "body": "[quote=0f8fad5b-d9cb-469f-a165-70867728950e]gone[quote=b]gone too[/quote][/quote]after",
    "plain": "after"
  },
  {
    "name": "an unclosed counterfeit keeps its words",
    "body": "[quote=Geno]words",
    "plain": "words"
  },
  {
    "name": "a stray closer after a counterfeit is text",
    "body": "[quote=Geno]a[/quote]b[/quote]",
    "plain": "ab[/quote]"
  },
  {
    "name": "a spoiler keeps its words",
    "body": "a[spoiler]secret words[/spoiler]b",
    "plain": "asecret wordsb"
  },
  {
    "name": "a spoiler title is not words",
    "body": "[spoiler=Big Reveal]the twist[/spoiler]",
    "plain": "the twist"
  },
  {
    "name": "a spoiler with a quoted title",
    "body": "[spoiler=\"Big Reveal\"]the twist[/spoiler]",
    "plain": "the twist"
  },
  {
    "name": "a spoiler with an empty title",
    "body": "[spoiler=]the twist[/spoiler]",
    "plain": "the twist"
  },
  {
    "name": "a spoiler title of 80 characters",
    "body": "[spoiler=nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn]kept[/spoiler]",
    "plain": "kept"
  },
  {
    "name": "a spoiler title of 81 characters is text",
    "body": "[spoiler=nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn]kept[/spoiler]",
    "plain": "[spoiler=nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn]kept[/spoiler]"
  },
  {
    "name": "a spoiler title of 80 units with astral characters",
    "body": "[spoiler=😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀]kept[/spoiler]",
    "plain": "kept"
  },
  {
    "name": "a spoiler title of 82 units with astral characters is text",
    "body": "[spoiler=😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀]kept[/spoiler]",
    "plain": "[spoiler=😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀]kept[/spoiler]"
  },
  {
    "name": "a spoiler title padded with blanks is trimmed before its length",
    "body": "[spoiler= nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn ]kept[/spoiler]",
    "plain": "kept"
  },
  {
    "name": "an unclosed spoiler keeps its words",
    "body": "[spoiler=x]words",
    "plain": "words"
  },
  {
    "name": "a spoiler holds block tags",
    "body": "[spoiler]a[quote=0f8fad5b-d9cb-469f-a165-70867728950e]gone[/quote]b[list][*]c[/list][/spoiler]",
    "plain": "a b c"
  },
  {
    "name": "a spoiler in a spoiler",
    "body": "[spoiler]a[spoiler]b[/spoiler]c[/spoiler]",
    "plain": "abc"
  },
  {
    "name": "an inline spoiler keeps its words",
    "body": "a [ispoiler]hidden[/ispoiler] b",
    "plain": "a hidden b"
  },
  {
    "name": "an inline spoiler with an attribute is text",
    "body": "[ispoiler=x]a[/ispoiler]",
    "plain": "[ispoiler=x]a[/ispoiler]"
  },
  {
    "name": "an inline spoiler holds inline formatting",
    "body": "[ispoiler]a[b]b[/b][color=red]c[/color][/ispoiler]",
    "plain": "abc"
  },
  {
    "name": "a quote inside an inline spoiler is text",
    "body": "[ispoiler]a[quote=0f8fad5b-d9cb-469f-a165-70867728950e]b[/quote]c[/ispoiler]",
    "plain": "a[quote=0f8fad5b-d9cb-469f-a165-70867728950e]b[/quote]c"
  },
  {
    "name": "a counterfeit inside an inline spoiler is text",
    "body": "[ispoiler]a[quote=Geno]b[/quote]c[/ispoiler]",
    "plain": "a[quote=Geno]b[/quote]c"
  },
  {
    "name": "code inside an inline spoiler is text",
    "body": "[ispoiler]a[code]b[/code]c[/ispoiler]",
    "plain": "a[code]b[/code]c"
  },
  {
    "name": "a list inside an inline spoiler is text",
    "body": "[ispoiler]a[list][*]b[/list]c[/ispoiler]",
    "plain": "a[list][*]b[/list]c"
  },
  {
    "name": "a spoiler inside an inline spoiler is text",
    "body": "[ispoiler]a[spoiler]b[/spoiler]c[/ispoiler]",
    "plain": "a[spoiler]b[/spoiler]c"
  },
  {
    "name": "a rule inside an inline spoiler is text",
    "body": "[ispoiler]a[hr]b[/ispoiler]",
    "plain": "a[hr]b"
  },
  {
    "name": "layout tags inside an inline spoiler are text",
    "body": "[ispoiler][center]a[/center][left]b[/left][right]c[/right][marquee]d[/marquee][/ispoiler]",
    "plain": "[center]a[/center][left]b[/left][right]c[/right][marquee]d[/marquee]"
  },
  {
    "name": "a video inside an inline spoiler is text",
    "body": "[ispoiler][video]https://youtu.be/dQw4w9WgXcQ[/video][youtube]dQw4w9WgXcQ[/youtube][/ispoiler]",
    "plain": "[video]https://youtu.be/dQw4w9WgXcQ[/video][youtube]dQw4w9WgXcQ[/youtube]"
  },
  {
    "name": "a link inside an inline spoiler is text",
    "body": "[ispoiler][url=http://a.example/x]a[/url] [url]http://a.example/y[/url][/ispoiler]",
    "plain": "[url=http://a.example/x]a[/url] [url]http://a.example/y[/url]"
  },
  {
    "name": "an image inside an inline spoiler is still an image",
    "body": "[ispoiler]a[img]http://a.example/x.png[/img]b[/ispoiler]",
    "plain": "a b"
  },
  {
    "name": "noparse inside an inline spoiler is still noparse",
    "body": "[ispoiler][noparse][b]x[/b][/noparse][/ispoiler]",
    "plain": "[b]x[/b]"
  },
  {
    "name": "an inline spoiler inside an inline spoiler is text and the first closer closes",
    "body": "[ispoiler]a[ispoiler]b[/ispoiler]c[/ispoiler]d",
    "plain": "a[ispoiler]bc[/ispoiler]d"
  },
  {
    "name": "a closer inside an inline spoiler cannot close a block outside",
    "body": "[quote=0f8fad5b-d9cb-469f-a165-70867728950e]gone[ispoiler]x[/quote]y[/ispoiler]z",
    "plain": ""
  },
  {
    "name": "a closer inside an inline spoiler cannot close a spoiler outside",
    "body": "[spoiler]a[ispoiler]x[/spoiler]y[/ispoiler]z",
    "plain": "ax[/spoiler]yz"
  },
  {
    "name": "a link closer inside an inline spoiler is text",
    "body": "[url=http://a.example/x]a[ispoiler]b[/url]c[/ispoiler]d[/url]",
    "plain": ""
  },
  {
    "name": "an inline spoiler opened after a link",
    "body": "[url]a[ispoiler]b[/ispoiler][/url]",
    "plain": "[url]ab[/url]"
  },
  {
    "name": "an unclosed inline spoiler blocks to the end",
    "body": "[ispoiler]a[quote=x]b[/quote]c",
    "plain": "a[quote=x]b[/quote]c"
  },
  {
    "name": "a list marker inside an inline spoiler in a list",
    "body": "[list][*][ispoiler]a[*]b[/ispoiler][/list]",
    "plain": "a[*]b"
  },
  {
    "name": "a video is a separator",
    "body": "a[video]https://youtu.be/dQw4w9WgXcQ[/video]b",
    "plain": "a b"
  },
  {
    "name": "a youtube id is a separator",
    "body": "a[youtube]dQw4w9WgXcQ[/youtube]b",
    "plain": "a b"
  },
  {
    "name": "a youtube tag with an address",
    "body": "a[youtube]https://youtu.be/dQw4w9WgXcQ[/youtube]b",
    "plain": "a b"
  },
  {
    "name": "a youtube id with blanks around it",
    "body": "a[youtube]  dQw4w9WgXcQ\n[/youtube]b",
    "plain": "a b"
  },
  {
    "name": "a youtube id one character short is text",
    "body": "a[youtube]Qw4w9WgXcQ[/youtube]b",
    "plain": "a[youtube]Qw4w9WgXcQ[/youtube]b"
  },
  {
    "name": "a youtube id one character long is text",
    "body": "a[youtube]dQw4w9WgXcQx[/youtube]b",
    "plain": "a[youtube]dQw4w9WgXcQx[/youtube]b"
  },
  {
    "name": "a bare id in a video tag is text",
    "body": "a[video]dQw4w9WgXcQ[/video]b",
    "plain": "a[video]dQw4w9WgXcQ[/video]b"
  },
  {
    "name": "a video with words that are no address is text",
    "body": "a[video]not a url[/video]b",
    "plain": "a[video]not a url[/video]b"
  },
  {
    "name": "a video with an attribute is text",
    "body": "a[video=x]https://youtu.be/dQw4w9WgXcQ[/video]b",
    "plain": "a[video=x]https://youtu.be/dQw4w9WgXcQ[/video]b"
  },
  {
    "name": "a video with no closer is text",
    "body": "a[video]https://youtu.be/dQw4w9WgXcQb",
    "plain": "a[video]https://youtu.be/dQw4w9WgXcQb"
  },
  {
    "name": "a video closer in capitals",
    "body": "a[VIDEO]https://youtu.be/dQw4w9WgXcQ[/VIDEO]b",
    "plain": "a b"
  },
  {
    "name": "a video holding a tag is text and the tag is read",
    "body": "a[video][b]https://youtu.be/dQw4w9WgXcQ[/b][/video]b",
    "plain": "a[video]https://youtu.be/dQw4w9WgXcQ[/video]b"
  },
  {
    "name": "a refused video leaves its words to be read",
    "body": "a[video][b]x[/b] y[/video]b",
    "plain": "a[video]x y[/video]b"
  },
  {
    "name": "a stray video closer is text",
    "body": "a[/video]b[/youtube]c",
    "plain": "a[/video]b[/youtube]c"
  },
  {
    "name": "two videos",
    "body": "a[video]https://youtu.be/dQw4w9WgXcQ[/video]b[video]https://vimeo.com/123[/video]c",
    "plain": "a b c"
  },
  {
    "name": "a refused video before a good one",
    "body": "[video]x[video]https://youtu.be/dQw4w9WgXcQ[/video]",
    "plain": "[video]x"
  },
  {
    "name": "a video inside a bold",
    "body": "[b]a[video]https://youtu.be/dQw4w9WgXcQ[/video]b[/b]",
    "plain": "a b"
  },
  {
    "name": "a video inside a quote is dropped with it",
    "body": "[quote=0f8fad5b-d9cb-469f-a165-70867728950e]a[video]https://youtu.be/dQw4w9WgXcQ[/video][/quote]b",
    "plain": "b"
  },
  {
    "name": "a video inside a counterfeit",
    "body": "[quote=x]a[video]https://youtu.be/dQw4w9WgXcQ[/video]b[/quote]",
    "plain": "a b"
  },
  {
    "name": "a video makes a bare link text",
    "body": "[url][video]https://youtu.be/dQw4w9WgXcQ[/video][/url]",
    "plain": "[url] [/url]"
  },
  {
    "name": "a youtube.com watch address",
    "body": "[video]https://www.youtube.com/watch?v=dQw4w9WgXcQ[/video]x",
    "plain": "x"
  },
  {
    "name": "a youtube.com watch address with other parameters",
    "body": "[video]https://youtube.com/watch?feature=x&v=dQw4w9WgXcQ&t=90s[/video]x",
    "plain": "x"
  },
  {
    "name": "a m.youtube.com watch address with a trailing slash",
    "body": "[video]https://m.youtube.com/watch/?v=dQw4w9WgXcQ[/video]x",
    "plain": "x"
  },
  {
    "name": "a watch address with a percent-encoded id",
    "body": "[video]https://youtube.com/watch?v=%64Qw4w9WgXcQ[/video]x",
    "plain": "x"
  },
  {
    "name": "a watch address with a plus in the id is text",
    "body": "[video]https://youtube.com/watch?v=dQw4w9WgXc+[/video]x",
    "plain": "[video]https://youtube.com/watch?v=dQw4w9WgXc+[/video]x"
  },
  {
    "name": "a watch address with an encoded name",
    "body": "[video]https://youtube.com/watch?%76=dQw4w9WgXcQ[/video]x",
    "plain": "x"
  },
  {
    "name": "a watch address whose first v is bad",
    "body": "[video]https://youtube.com/watch?v=bad&v=dQw4w9WgXcQ[/video]x",
    "plain": "[video]https://youtube.com/watch?v=bad&v=dQw4w9WgXcQ[/video]x"
  },
  {
    "name": "a watch address with no v is text",
    "body": "[video]https://youtube.com/watch?x=dQw4w9WgXcQ[/video]x",
    "plain": "[video]https://youtube.com/watch?x=dQw4w9WgXcQ[/video]x"
  },
  {
    "name": "a watch address with the id in the fragment is text",
    "body": "[video]https://youtube.com/watch#v=dQw4w9WgXcQ[/video]x",
    "plain": "[video]https://youtube.com/watch#v=dQw4w9WgXcQ[/video]x"
  },
  {
    "name": "a watch address with an id of the wrong length is text",
    "body": "[video]https://youtube.com/watch?v=dQw4w9WgXcQx[/video]x",
    "plain": "[video]https://youtube.com/watch?v=dQw4w9WgXcQx[/video]x"
  },
  {
    "name": "a youtube.com address that is not a watch is text",
    "body": "[video]https://youtube.com/embed/dQw4w9WgXcQ[/video]x",
    "plain": "[video]https://youtube.com/embed/dQw4w9WgXcQ[/video]x"
  },
  {
    "name": "a youtube.com mp4 address is text",
    "body": "[video]https://youtube.com/x.mp4[/video]x",
    "plain": "[video]https://youtube.com/x.mp4[/video]x"
  },
  {
    "name": "a shorts address",
    "body": "[video]https://youtube.com/shorts/dQw4w9WgXcQ[/video]x",
    "plain": "x"
  },
  {
    "name": "a live address",
    "body": "[video]https://www.youtube.com/live/dQw4w9WgXcQ/[/video]x",
    "plain": "x"
  },
  {
    "name": "a shorts address with one segment too many is text",
    "body": "[video]https://youtube.com/shorts/dQw4w9WgXcQ/x[/video]x",
    "plain": "[video]https://youtube.com/shorts/dQw4w9WgXcQ/x[/video]x"
  },
  {
    "name": "a youtu.be address with a time",
    "body": "[video]https://youtu.be/dQw4w9WgXcQ?t=1m30s[/video]x",
    "plain": "x"
  },
  {
    "name": "a youtu.be address with two segments is text",
    "body": "[video]https://youtu.be/a/dQw4w9WgXcQ[/video]x",
    "plain": "[video]https://youtu.be/a/dQw4w9WgXcQ[/video]x"
  },
  {
    "name": "a youtu.be address with a dot segment",
    "body": "[video]https://youtu.be/x/../dQw4w9WgXcQ[/video]x",
    "plain": "x"
  },
  {
    "name": "a youtu.be address with an encoded dot segment",
    "body": "[video]https://youtu.be/x/%2E%2e/dQw4w9WgXcQ[/video]x",
    "plain": "x"
  },
  {
    "name": "a youtu.be address ending in a dot segment",
    "body": "[video]https://youtu.be/dQw4w9WgXcQ/.[/video]x",
    "plain": "x"
  },
  {
    "name": "a youtu.be address ending in a double dot is text",
    "body": "[video]https://youtu.be/dQw4w9WgXcQ/..[/video]x",
    "plain": "[video]https://youtu.be/dQw4w9WgXcQ/..[/video]x"
  },
  {
    "name": "a youtu.be address in capitals",
    "body": "[video]HTTPS://YOUTU.BE/dQw4w9WgXcQ[/video]x",
    "plain": "x"
  },
  {
    "name": "a youtu.be address over http",
    "body": "[video]http://youtu.be/dQw4w9WgXcQ[/video]x",
    "plain": "x"
  },
  {
    "name": "a youtu.be address with credentials is text",
    "body": "[video]https://a@youtu.be/dQw4w9WgXcQ[/video]x",
    "plain": "[video]https://a@youtu.be/dQw4w9WgXcQ[/video]x"
  },
  {
    "name": "a youtu.be address with its default port",
    "body": "[video]https://youtu.be:443/dQw4w9WgXcQ[/video]x",
    "plain": "x"
  },
  {
    "name": "a youtu.be address with its default port written long",
    "body": "[video]https://youtu.be:00443/dQw4w9WgXcQ[/video]x",
    "plain": "x"
  },
  {
    "name": "a youtu.be address with another port is text",
    "body": "[video]https://youtu.be:8080/dQw4w9WgXcQ[/video]x",
    "plain": "[video]https://youtu.be:8080/dQw4w9WgXcQ[/video]x"
  },
  {
    "name": "a youtu.be address with the other scheme default port is text",
    "body": "[video]https://youtu.be:80/dQw4w9WgXcQ[/video]x",
    "plain": "[video]https://youtu.be:80/dQw4w9WgXcQ[/video]x"
  },
  {
    "name": "an http address with port 80",
    "body": "[video]http://youtu.be:80/dQw4w9WgXcQ[/video]x",
    "plain": "x"
  },
  {
    "name": "an address with a port too large is text",
    "body": "[video]https://youtu.be:65536/dQw4w9WgXcQ[/video]x",
    "plain": "[video]https://youtu.be:65536/dQw4w9WgXcQ[/video]x"
  },
  {
    "name": "an address with an empty port is text",
    "body": "[video]https://youtu.be:/dQw4w9WgXcQ[/video]x",
    "plain": "[video]https://youtu.be:/dQw4w9WgXcQ[/video]x"
  },
  {
    "name": "a youtu.be lookalike host is text",
    "body": "[video]https://youtu.be.evil.example/dQw4w9WgXcQ[/video]x",
    "plain": "[video]https://youtu.be.evil.example/dQw4w9WgXcQ[/video]x"
  },
  {
    "name": "a youtube lookalike host is text",
    "body": "[video]https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ[/video]x",
    "plain": "[video]https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ[/video]x"
  },
  {
    "name": "a youtube lookalike with a prefix is text",
    "body": "[video]https://evilyoutube.com/watch?v=dQw4w9WgXcQ[/video]x",
    "plain": "[video]https://evilyoutube.com/watch?v=dQw4w9WgXcQ[/video]x"
  },
  {
    "name": "a youtube lookalike with a suffix mp4 is a file",
    "body": "[video]https://youtube.com.evil.example/a.mp4[/video]x",
    "plain": "x"
  },
  {
    "name": "a vimeo address",
    "body": "[video]https://vimeo.com/123456[/video]x",
    "plain": "x"
  },
  {
    "name": "a vimeo address with letters is text",
    "body": "[video]https://vimeo.com/12a[/video]x",
    "plain": "[video]https://vimeo.com/12a[/video]x"
  },
  {
    "name": "a vimeo address with 13 digits is text",
    "body": "[video]https://vimeo.com/1234567890123[/video]x",
    "plain": "[video]https://vimeo.com/1234567890123[/video]x"
  },
  {
    "name": "a player.vimeo.com address is text",
    "body": "[video]https://player.vimeo.com/video/123[/video]x",
    "plain": "[video]https://player.vimeo.com/video/123[/video]x"
  },
  {
    "name": "a twitch clip address",
    "body": "[video]https://clips.twitch.tv/AbC_d-1[/video]x",
    "plain": "x"
  },
  {
    "name": "a twitch channel clip address",
    "body": "[video]https://www.twitch.tv/some_user/clip/AbC_d-1[/video]x",
    "plain": "x"
  },
  {
    "name": "a twitch channel address with CLIP in capitals is text",
    "body": "[video]https://www.twitch.tv/some_user/CLIP/AbC_d-1[/video]x",
    "plain": "[video]https://www.twitch.tv/some_user/CLIP/AbC_d-1[/video]x"
  },
  {
    "name": "a twitch address with a bad clip id is text",
    "body": "[video]https://twitch.tv/u/clip/a.b[/video]x",
    "plain": "[video]https://twitch.tv/u/clip/a.b[/video]x"
  },
  {
    "name": "a streamable address",
    "body": "[video]https://streamable.com/AbC12[/video]x",
    "plain": "x"
  },
  {
    "name": "a streamable address that is too short is text",
    "body": "[video]https://streamable.com/ab[/video]x",
    "plain": "[video]https://streamable.com/ab[/video]x"
  },
  {
    "name": "a streamable address that is too long is text",
    "body": "[video]https://streamable.com/abcdefghijklmnopq[/video]x",
    "plain": "[video]https://streamable.com/abcdefghijklmnopq[/video]x"
  },
  {
    "name": "a niconico address",
    "body": "[video]https://www.nicovideo.jp/watch/sm9[/video]x",
    "plain": "x"
  },
  {
    "name": "a niconico address with capitals in the id is text",
    "body": "[video]https://www.nicovideo.jp/watch/SM9[/video]x",
    "plain": "[video]https://www.nicovideo.jp/watch/SM9[/video]x"
  },
  {
    "name": "a niconico address that is not a watch is text",
    "body": "[video]https://www.nicovideo.jp/user/sm9[/video]x",
    "plain": "[video]https://www.nicovideo.jp/user/sm9[/video]x"
  },
  {
    "name": "a soundcloud address",
    "body": "[video]https://soundcloud.com/some-artist/a_track[/video]x",
    "plain": "x"
  },
  {
    "name": "a soundcloud address with one segment is text",
    "body": "[video]https://soundcloud.com/some-artist[/video]x",
    "plain": "[video]https://soundcloud.com/some-artist[/video]x"
  },
  {
    "name": "a soundcloud address with three segments is text",
    "body": "[video]https://soundcloud.com/a/b/c[/video]x",
    "plain": "[video]https://soundcloud.com/a/b/c[/video]x"
  },
  {
    "name": "an mp4 file over https",
    "body": "[video]https://a.example/clips/x.mp4[/video]x",
    "plain": "x"
  },
  {
    "name": "a webm file with capitals and a query",
    "body": "[video]https://a.example/x.WebM?dl=1#t=3[/video]x",
    "plain": "x"
  },
  {
    "name": "an mp4 file over http is text",
    "body": "[video]http://a.example/x.mp4[/video]x",
    "plain": "[video]http://a.example/x.mp4[/video]x"
  },
  {
    "name": "a file whose query holds mp4 is text",
    "body": "[video]https://a.example/x?f=a.mp4[/video]x",
    "plain": "[video]https://a.example/x?f=a.mp4[/video]x"
  },
  {
    "name": "a file ending in a dot segment is text",
    "body": "[video]https://a.example/x.mp4/.[/video]x",
    "plain": "[video]https://a.example/x.mp4/.[/video]x"
  },
  {
    "name": "a file made by a double dot segment",
    "body": "[video]https://a.example/y.mp4/../x.mp4[/video]x",
    "plain": "x"
  },
  {
    "name": "a file removed by a double dot segment is text",
    "body": "[video]https://a.example/x.mp4/%2e%2E[/video]x",
    "plain": "[video]https://a.example/x.mp4/%2e%2E[/video]x"
  },
  {
    "name": "a file named mp4 with no dot is text",
    "body": "[video]https://a.example/mp4[/video]x",
    "plain": "[video]https://a.example/mp4[/video]x"
  },
  {
    "name": "a file at an IPv4 address",
    "body": "[video]https://1.2.3.4/x.mp4[/video]x",
    "plain": "x"
  },
  {
    "name": "a file at an IPv4 address in hex",
    "body": "[video]https://0x7f.1/x.mp4[/video]x",
    "plain": "x"
  },
  {
    "name": "a file at a single number host",
    "body": "[video]https://999999999/x.mp4[/video]x",
    "plain": "x"
  },
  {
    "name": "a file at an IPv4 address with a part too large is text",
    "body": "[video]https://1.2.3.256/x.mp4[/video]x",
    "plain": "[video]https://1.2.3.256/x.mp4[/video]x"
  },
  {
    "name": "a file at an address with five parts is text",
    "body": "[video]https://1.2.3.4.5/x.mp4[/video]x",
    "plain": "[video]https://1.2.3.4.5/x.mp4[/video]x"
  },
  {
    "name": "a file at a host ending in a number is text",
    "body": "[video]https://a.1/x.mp4[/video]x",
    "plain": "[video]https://a.1/x.mp4[/video]x"
  },
  {
    "name": "a file at a host ending in an octal that is not one is text",
    "body": "[video]https://a.08/x.mp4[/video]x",
    "plain": "[video]https://a.08/x.mp4[/video]x"
  },
  {
    "name": "a file at a host ending in 0x is text",
    "body": "[video]https://a.0x/x.mp4[/video]x",
    "plain": "[video]https://a.0x/x.mp4[/video]x"
  },
  {
    "name": "a file at a bare 0x host",
    "body": "[video]https://0x/x.mp4[/video]x",
    "plain": "x"
  },
  {
    "name": "a file at an international host",
    "body": "[video]https://xn--bcher-kva.example/x.mp4[/video]x",
    "plain": "x"
  },
  {
    "name": "a file at a bad international host is text",
    "body": "[video]https://xn--a/x.mp4[/video]x",
    "plain": "[video]https://xn--a/x.mp4[/video]x"
  },
  {
    "name": "a file at an empty international label is text",
    "body": "[video]https://xn--/x.mp4[/video]x",
    "plain": "[video]https://xn--/x.mp4[/video]x"
  },
  {
    "name": "a file at an empty international label with a dot is text",
    "body": "[video]https://xn--.com/a.mp4[/video]x",
    "plain": "[video]https://xn--.com/a.mp4[/video]x"
  },
  {
    "name": "a file at an international label of only hyphens is text",
    "body": "[video]https://xn---.com/a.mp4[/video]x",
    "plain": "[video]https://xn---.com/a.mp4[/video]x"
  },
  {
    "name": "a file at a host with a hyphen run",
    "body": "[video]https://ab--c.example/x.mp4[/video]x",
    "plain": "x"
  },
  {
    "name": "a file at a host with a leading hyphen label",
    "body": "[video]https://-a-.b/x.mp4[/video]x",
    "plain": "[video]https://-a-.b/x.mp4[/video]x"
  },
  {
    "name": "a file with a port",
    "body": "[video]https://a.example:8443/x.mp4[/video]x",
    "plain": "[video]https://a.example:8443/x.mp4[/video]x"
  },
  {
    "name": "an address with a host dot dot is text",
    "body": "[video]https://a..example/x.mp4[/video]x",
    "plain": "[video]https://a..example/x.mp4[/video]x"
  },
  {
    "name": "an address in a refused scheme is text",
    "body": "[video]ftp://a.example/x.mp4[/video]x",
    "plain": "[video]ftp://a.example/x.mp4[/video]x"
  },
  {
    "name": "an address with a space is text",
    "body": "[video]https://a.example/x y.mp4[/video]x",
    "plain": "[video]https://a.example/x y.mp4[/video]x"
  },
  {
    "name": "an address with a relative path is text",
    "body": "[video]/x.mp4[/video]x",
    "plain": "[video]/x.mp4[/video]x"
  },
  {
    "name": "a video address 2048 characters long",
    "body": "[video]https://a.example/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mp4[/video]x",
    "plain": "x"
  },
  {
    "name": "a video address 2049 characters long is text",
    "body": "[video]https://a.example/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mp4[/video]x",
    "plain": "[video]https://a.example/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mp4[/video]x"
  },
  {
    "name": "a video address with blanks past the bound is text",
    "body": "[video]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        https://youtu.be/dQw4w9WgXcQ[/video]x",
    "plain": "[video] https://youtu.be/dQw4w9WgXcQ[/video]x"
  },
  {
    "name": "a video address with blanks inside the bound",
    "body": "[video]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                https://youtu.be/dQw4w9WgXcQ                                        [/video]x",
    "plain": "x"
  },
  {
    "name": "a youtube id behind blanks past the bound is text",
    "body": "[youtube]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        dQw4w9WgXcQ[/youtube]x",
    "plain": "[youtube] dQw4w9WgXcQ[/youtube]x"
  },
  {
    "name": "a video behind a long run of openers that cannot be videos",
    "body": "[video][video][video][video][video]https://youtu.be/dQw4w9WgXcQ[/video]x",
    "plain": "[video][video][video][video] x"
  },
  {
    "name": "a video and a youtube with the closers crossed",
    "body": "[video]https://youtu.be/dQw4w9WgXcQ[/youtube]x[/video]",
    "plain": "[video]https://youtu.be/dQw4w9WgXcQ[/youtube]x[/video]"
  },
  {
    "name": "center keeps its words",
    "body": "a[center]b c[/center]d",
    "plain": "ab cd"
  },
  {
    "name": "left keeps its words",
    "body": "a[left]b c[/left]d",
    "plain": "ab cd"
  },
  {
    "name": "right keeps its words",
    "body": "a[right]b c[/right]d",
    "plain": "ab cd"
  },
  {
    "name": "align is no tag",
    "body": "[align=center]a[/align]",
    "plain": "[align=center]a[/align]"
  },
  {
    "name": "center with an attribute is text",
    "body": "[center=x]a[/center]",
    "plain": "[center=x]a[/center]"
  },
  {
    "name": "left with an attribute is text",
    "body": "[left=x]a[/left]",
    "plain": "[left=x]a[/left]"
  },
  {
    "name": "an unclosed center keeps its words",
    "body": "[center]a b",
    "plain": "a b"
  },
  {
    "name": "crossed layout tags",
    "body": "[center][b]x[/center]y[/b]",
    "plain": "xy[/b]"
  },
  {
    "name": "a stray layout closer is text",
    "body": "a[/center]b[/right]c",
    "plain": "a[/center]b[/right]c"
  },
  {
    "name": "sub keeps its words",
    "body": "H[sub]2[/sub]O",
    "plain": "H2O"
  },
  {
    "name": "sup keeps its words",
    "body": "x[sup]2[/sup]",
    "plain": "x2"
  },
  {
    "name": "sub with an attribute is text",
    "body": "[sub=1]a[/sub]",
    "plain": "[sub=1]a[/sub]"
  },
  {
    "name": "font keeps its words",
    "body": "[font=Verdana]a b[/font]",
    "plain": "a b"
  },
  {
    "name": "font in capitals and padded",
    "body": "[font= COMIC SANS MS ]a[/font]",
    "plain": "a"
  },
  {
    "name": "font with a quoted name",
    "body": "[font=\"Times New Roman\"]a[/font]",
    "plain": "a"
  },
  {
    "name": "font with a name not in the list is text",
    "body": "[font=NotAFont]a[/font]",
    "plain": "[font=NotAFont]a[/font]"
  },
  {
    "name": "font with no name is text",
    "body": "[font]a[/font] [font=]b[/font]",
    "plain": "[font]a[/font] [font=]b[/font]"
  },
  {
    "name": "font with a name that is only a prefix is text",
    "body": "[font=Courier]a[/font]",
    "plain": "[font=Courier]a[/font]"
  },
  {
    "name": "marquee keeps its words",
    "body": "a[marquee]b c[/marquee]d",
    "plain": "ab cd"
  },
  {
    "name": "marquee with an attribute is text",
    "body": "[marquee=x]a[/marquee]",
    "plain": "[marquee=x]a[/marquee]"
  },
  {
    "name": "glow keeps its words",
    "body": "[glow]a b[/glow]",
    "plain": "a b"
  },
  {
    "name": "glow with a color keeps its words",
    "body": "[glow=red]a[/glow] [glow=#abc]b[/glow]",
    "plain": "a b"
  },
  {
    "name": "glow with a bad color is text",
    "body": "[glow=notacolor]a[/glow]",
    "plain": "[glow=notacolor]a[/glow]"
  },
  {
    "name": "shadow keeps its words",
    "body": "[shadow]a b[/shadow] [shadow=navy]c[/shadow]",
    "plain": "a b c"
  },
  {
    "name": "shadow with a bad color is text",
    "body": "[shadow=#12]a[/shadow]",
    "plain": "[shadow=#12]a[/shadow]"
  },
  {
    "name": "rainbow keeps its words",
    "body": "[rainbow]a b[/rainbow]",
    "plain": "a b"
  },
  {
    "name": "rainbow with an attribute is text",
    "body": "[rainbow=x]a[/rainbow]",
    "plain": "[rainbow=x]a[/rainbow]"
  },
  {
    "name": "highlight keeps its words",
    "body": "[highlight]a[/highlight] [highlight=pink]b[/highlight] [highlight=#ff0]c[/highlight]",
    "plain": "a b c"
  },
  {
    "name": "highlight with a bad color is text",
    "body": "[highlight=bad]a[/highlight]",
    "plain": "[highlight=bad]a[/highlight]"
  },
  {
    "name": "highlight with an empty color is text",
    "body": "[highlight=]a[/highlight]",
    "plain": "[highlight=]a[/highlight]"
  },
  {
    "name": "effects nested",
    "body": "[rainbow][glow=red][shadow][highlight][marquee]x[/marquee][/highlight][/shadow][/glow][/rainbow]",
    "plain": "x"
  },
  {
    "name": "a layout tag in a list item",
    "body": "[list][*][center]a[/center][*]b[/list]",
    "plain": "a b"
  },
  {
    "name": "a layout tag inside a link",
    "body": "[url=http://a.example/x][center]a[/center][/url]b",
    "plain": "b"
  },
  {
    "name": "a layout tag inside a bare link makes it text",
    "body": "[url][center]http://a.example[/center][/url]",
    "plain": "[url]http://a.example[/url]"
  },
  {
    "name": "a layout tag inside a real quote is dropped with it",
    "body": "[quote=0f8fad5b-d9cb-469f-a165-70867728950e][center]gone[/center][/quote]after",
    "plain": "after"
  },
  {
    "name": "thirty-three centers: the last opener is text",
    "body": "[center][center][center][center][center][center][center][center][center][center][center][center][center][center][center][center][center][center][center][center][center][center][center][center][center][center][center][center][center][center][center][center][center]x[/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center][/center]",
    "plain": "[center]x[/center]"
  },
  {
    "name": "thirty-three spoilers: the last opener is text",
    "body": "[spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler][spoiler]x[/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler][/spoiler]",
    "plain": "[spoiler]x[/spoiler]"
  },
  {
    "name": "thirty-three counterfeits: the last opener is text",
    "body": "[quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a][quote=a]x[/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote][/quote]",
    "plain": "[quote=a]x[/quote]"
  },
  {
    "name": "thirty-three inline spoilers: the second opener is text",
    "body": "[ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler]x[/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler]",
    "plain": "[ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler][ispoiler]x[/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler][/ispoiler]"
  },
  {
    "name": "a rule is a separator",
    "body": "a[hr]b",
    "plain": "a b"
  },
  {
    "name": "a rule closer is text",
    "body": "a[/hr]b",
    "plain": "a[/hr]b"
  },
  {
    "name": "a rule with an attribute is text",
    "body": "a[hr=x]b",
    "plain": "a[hr=x]b"
  },
  {
    "name": "a rule with its closer",
    "body": "a[hr][/hr]b",
    "plain": "a [/hr]b"
  },
  {
    "name": "a rule in capitals",
    "body": "a[HR]b",
    "plain": "a b"
  },
  {
    "name": "a rule inside a bold",
    "body": "[b]a[hr]b[/b]",
    "plain": "a b"
  },
  {
    "name": "a rule inside a bare link makes it text",
    "body": "[url][hr][/url]",
    "plain": "[url] [/url]"
  },
  {
    "name": "a rule inside a real quote is dropped",
    "body": "[quote=0f8fad5b-d9cb-469f-a165-70867728950e]a[hr]b[/quote]c",
    "plain": "c"
  },
  {
    "name": "noparse keeps its contents as text",
    "body": "[noparse][b]x[/b][/noparse]",
    "plain": "[b]x[/b]"
  },
  {
    "name": "noparse in capitals",
    "body": "a[NOPARSE][i]x[/i][/NOPARSE]b",
    "plain": "a[i]x[/i]b"
  },
  {
    "name": "noparse with no closer is text and the rest is read",
    "body": "a[noparse][b]x[/b]",
    "plain": "a[noparse]x"
  },
  {
    "name": "noparse with an attribute is text",
    "body": "a[noparse=x][b]x[/b][/noparse]",
    "plain": "a[noparse=x]x[/noparse]"
  },
  {
    "name": "an empty noparse",
    "body": "a[noparse][/noparse]b",
    "plain": "ab"
  },
  {
    "name": "a stray noparse closer is text",
    "body": "a[/noparse]b",
    "plain": "a[/noparse]b"
  },
  {
    "name": "noparse holding closers and openers",
    "body": "[b][noparse]x[/b][u][/noparse]y[/b]",
    "plain": "x[/b][u]y"
  },
  {
    "name": "noparse holding a quote",
    "body": "[noparse][quote=0f8fad5b-d9cb-469f-a165-70867728950e]kept[/quote][/noparse]",
    "plain": "[quote=0f8fad5b-d9cb-469f-a165-70867728950e]kept[/quote]"
  },
  {
    "name": "noparse holding code",
    "body": "[noparse][code]kept[/code][/noparse]",
    "plain": "[code]kept[/code]"
  },
  {
    "name": "noparse inside code is code",
    "body": "[code][noparse]x[/code]y[/noparse]",
    "plain": "y[/noparse]"
  },
  {
    "name": "noparse inside a real quote is dropped",
    "body": "[quote=0f8fad5b-d9cb-469f-a165-70867728950e][noparse]gone[/noparse][/quote]after",
    "plain": "after"
  },
  {
    "name": "noparse inside a counterfeit",
    "body": "[quote=a][noparse][b]kept[/b][/noparse][/quote]",
    "plain": "[b]kept[/b]"
  },
  {
    "name": "noparse holding a video",
    "body": "[noparse][video]https://youtu.be/dQw4w9WgXcQ[/video][/noparse]",
    "plain": "[video]https://youtu.be/dQw4w9WgXcQ[/video]"
  },
  {
    "name": "noparse holding an image",
    "body": "[noparse][img]http://a.example/x.png[/img][/noparse]",
    "plain": "[img]http://a.example/x.png[/img]"
  },
  {
    "name": "two noparse",
    "body": "[noparse][b][/noparse] and [noparse][/b][/noparse]",
    "plain": "[b] and [/b]"
  },
  {
    "name": "noparse closer first match",
    "body": "[noparse]a[/noparse]b[/noparse]c",
    "plain": "ab[/noparse]c"
  },
  {
    "name": "noparse is a bare link only alone",
    "body": "[url][noparse]http://a.example/x[/noparse][/url]after",
    "plain": "after"
  },
  {
    "name": "noparse is a link target only when nothing else is there",
    "body": "[url] [noparse]http://a.example/x[/noparse][/url]after",
    "plain": "[url] http://a.example/x[/url]after"
  },
  {
    "name": "noparse after text in a bare link",
    "body": "[url]http://a.example/x[noparse][/noparse][/url]after",
    "plain": "after"
  },
  {
    "name": "an empty noparse before an address in a bare link",
    "body": "[url][noparse][/noparse]http://a.example/x[/url]after",
    "plain": "after"
  },
  {
    "name": "two noparse in a bare link",
    "body": "[url][noparse]http://a.example[/noparse][noparse]/x[/noparse][/url]after",
    "plain": "[url]http://a.example/x[/url]after"
  },
  {
    "name": "noparse with a bad address in a bare link",
    "body": "[url][noparse]javascript:x[/noparse][/url]after",
    "plain": "[url]javascript:x[/url]after"
  },
  {
    "name": "noparse with text after it in a bare link",
    "body": "[url][noparse]http://a.example/x[/noparse]y[/url]after",
    "plain": "[url]http://a.example/xy[/url]after"
  },
  {
    "name": "noparse with a layout tag in a bare link",
    "body": "[url][noparse]http://a.example/x[/noparse][hr][/url]after",
    "plain": "[url]http://a.example/x [/url]after"
  },
  {
    "name": "noparse with a literal opener in a bare link",
    "body": "[url][noparse]http://a.example/x[/noparse][b=1][/url]after",
    "plain": "[url]http://a.example/x[b=1][/url]after"
  },
  {
    "name": "noparse with a literal opener before it in a bare link",
    "body": "[url][b=1][noparse]http://a.example/x[/noparse][/url]after",
    "plain": "[url][b=1]http://a.example/x[/url]after"
  },
  {
    "name": "noparse padded with blanks in a bare link",
    "body": "[url][noparse]  http://a.example/x  [/noparse][/url]after",
    "plain": "after"
  },
  {
    "name": "an address in text keeps its words",
    "body": "see http://a.example/x, and https://b.example/y. ok",
    "plain": "see http://a.example/x, and https://b.example/y. ok"
  },
  {
    "name": "an address in a bold keeps its words",
    "body": "[b]see http://a.example/x[/b]",
    "plain": "see http://a.example/x"
  },
  {
    "name": "an address inside a spoiler keeps its words",
    "body": "[spoiler]http://a.example/x[/spoiler] [ispoiler]http://a.example/y[/ispoiler]",
    "plain": "http://a.example/x http://a.example/y"
  },
  {
    "name": "a javascript address stays text",
    "body": "a javascript:alert(1) http://a.example/x\"y b",
    "plain": "a javascript:alert(1) http://a.example/x\"y b"
  },
  {
    "name": "an address inside a link keeps no words",
    "body": "[url]http://a.example/x[/url] and [url=http://a.example/y]http://a.example/z[/url]",
    "plain": "and"
  },
  {
    "name": "an address in a counterfeit keeps its words",
    "body": "[quote=Geno]see http://a.example/x[/quote]",
    "plain": "see http://a.example/x"
  },
  {
    "name": "an address in a list item keeps its words",
    "body": "[list][*]http://a.example/x[*]b[/list]",
    "plain": "http://a.example/x b"
  },
  {
    "name": "an address after a layout tag",
    "body": "[center]http://a.example/x[/center]",
    "plain": "http://a.example/x"
  }
];
