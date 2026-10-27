import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { userEvent } from "vitest/browser";
import PageSelector from "./PageSelector.svelte";

vi.mock("$app/paths", () => ({ resolve: (path: string) => path }));
vi.mock("$app/state", () => ({ page: { params: { page_path: "" } } }));

const pages = [
  { page_title: "Home", page_path: "", page_header: "", page_logo: null },
  { page_title: "DiffDevil", page_path: "diffdevil", page_header: "", page_logo: null },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderSelector() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => pages }) as Response),
  );
  const screen = await render(PageSelector);
  await expect.element(screen.getByRole("button", { name: /Home/ })).toBeInTheDocument();
  return screen;
}

describe("PageSelector keyboard menu", () => {
  it("opens on the first page, moves among linked menu items with arrows, and activates the selected page", async () => {
    const screen = await renderSelector();
    const trigger = screen.getByRole("button", { name: /Home/ });
    await userEvent.tab();
    expect(document.activeElement).toBe(trigger.element());

    await userEvent.keyboard("{Enter}");
    await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
    const home = screen.getByRole("menuitem", { name: "Home" });
    const diffdevil = screen.getByRole("menuitem", { name: "DiffDevil" });
    await expect.element(home).toHaveAttribute("href", "/");
    await expect.element(diffdevil).toHaveAttribute("href", "/diffdevil");
    expect(document.activeElement).toBe(home.element());

    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(diffdevil.element());
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(home.element());

    let activatedHref: string | null = null;
    const preventNavigation = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof HTMLAnchorElement && target.getAttribute("role") === "menuitem") {
        activatedHref = target.getAttribute("href");
        event.preventDefault();
      }
    };
    document.addEventListener("click", preventNavigation);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    document.removeEventListener("click", preventNavigation);

    expect(activatedHref).toBe("/diffdevil");
    await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(trigger.element());
  });

  it("closes on Escape and lets Tab move to the following RSS control", async () => {
    const screen = await renderSelector();
    const trigger = screen.getByRole("button", { name: /Home/ });
    const rss = document.createElement("a");
    rss.href = "/rss.xml";
    rss.setAttribute("aria-label", "RSS feed");
    screen.container.append(rss);
    await userEvent.tab();
    await userEvent.keyboard("{Space}");
    const home = screen.getByRole("menuitem", { name: "Home" });
    expect(document.activeElement).toBe(home.element());

    await userEvent.keyboard("{Escape}");
    await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(trigger.element());

    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Tab}");
    await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(rss);
  });
});
