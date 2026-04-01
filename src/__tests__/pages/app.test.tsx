import App from "@/app";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("app page", () => {
	const setup = async () => {
		await act(async () => {
			render(<App />);
			await Promise.resolve();
		});
	};

	it("should render the file manager layout", async () => {
		await setup();
		expect(screen.getAllByText("Open Project Folder").length).toBeGreaterThan(0);
		expect(screen.getByLabelText("New file")).toBeDefined();
		expect(screen.getByLabelText("New folder")).toBeDefined();
		expect(screen.getByText("Details")).toBeDefined();
	});

	it("should render resizable panel group", async () => {
		await setup();
		expect(screen.getByTestId("main-layout")).toBeDefined();
	});

	it("should open settings in the editor", async () => {
		await setup();
		fireEvent.click(screen.getByLabelText("Open settings"));
		expect(
			await screen.findByText(
				"Configure the workbench and explorer using a schema-driven settings surface modeled after Codally and VS Code.",
			),
		).toBeDefined();
	});
});
