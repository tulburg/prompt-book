import App from "@/app";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("app page", () => {
	const setup = () => {
		render(<App />);
	};

	it("should render the file manager layout", () => {
		setup();
		expect(screen.getAllByText("Open Project Folder").length).toBeGreaterThan(0);
		expect(screen.getByLabelText("New file")).toBeDefined();
		expect(screen.getByLabelText("New folder")).toBeDefined();
		expect(screen.getByText("Details")).toBeDefined();
	});

	it("should render resizable panel group", () => {
		setup();
		expect(screen.getByTestId("main-layout")).toBeDefined();
	});
});
