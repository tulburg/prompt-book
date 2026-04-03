import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownMessage } from "@/ui/higher/MarkdownMessage";

describe("MarkdownMessage", () => {
	it("renders readme-style headings, lists, and inline formatting", () => {
		render(
			<MarkdownMessage
				content={
					"# Shipping Plan\n\n- **Fix** the header\n- Add `code` styling\n\nSee [docs](https://example.com)."
				}
			/>,
		);

		expect(
			screen.getByRole("heading", { level: 1, name: "Shipping Plan" }),
		).toBeDefined();
		expect(screen.getByRole("list")).toBeDefined();
		expect(screen.getByText("Fix").tagName).toBe("STRONG");
		expect(screen.getByText("code").tagName).toBe("CODE");
		expect(screen.getByRole("link", { name: "docs" }).getAttribute("href")).toBe(
			"https://example.com",
		);
	});

	it("renders fenced code blocks with the language label", () => {
		render(
			<MarkdownMessage
				content={"```ts\nconst answer = 42;\nconsole.log(answer);\n```"}
			/>,
		);

		expect(screen.getByText("ts")).toBeDefined();
		expect(screen.getByText(/const answer = 42;/)).toBeDefined();
		expect(screen.getByText(/console\.log\(answer\);/)).toBeDefined();
	});
});
