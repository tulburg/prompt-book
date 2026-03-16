import App from "@/app";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("app page", () => {
	const setup = () => {
		render(<App />);
	};

	it("should render app page with FrameHost layout", () => {
		setup();
		expect(screen.getByText("Sidebar")).toBeDefined();
		expect(screen.getByText("Explorer")).toBeDefined();
		expect(screen.getByText("Outline")).toBeDefined();
		expect(screen.getByText("Properties")).toBeDefined();
	});

	it("should render resizable panel group", () => {
		setup();
		expect(screen.getByTestId("main-layout")).toBeDefined();
	});
});
