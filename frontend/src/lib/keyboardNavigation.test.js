import { focusNextField } from "./keyboardNavigation";

describe("keyboard field navigation", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("focuses the next enabled input in the active dialog", () => {
    document.body.innerHTML = `
      <main>
        <input id="outside">
        <section role="dialog">
          <input id="current">
          <select id="next"><option value="1">One</option></select>
          <input id="disabled" disabled>
        </section>
      </main>
    `;
    const current = document.getElementById("current");
    const next = document.getElementById("next");

    expect(focusNextField(current)).toBe(true);
    expect(document.activeElement).toBe(next);
  });

  test("returns false when the current field is last", () => {
    document.body.innerHTML = '<section role="dialog"><input id="last"></section>';

    expect(focusNextField(document.getElementById("last"))).toBe(false);
  });
});
