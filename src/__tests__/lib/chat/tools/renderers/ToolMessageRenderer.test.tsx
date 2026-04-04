import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/lib/chat/types";
import { ToolMessageRenderer } from "@/lib/chat/tools/renderers/ToolMessageRenderer";

describe("ToolMessageRenderer", () => {
  it("renders the shapes icon for context tool messages", () => {
    const message: ChatMessage = {
      id: "tool-use-context-1",
      role: "assistant",
      content: 'Context({"action":"write","filename":"codebase.md"})',
      timestamp: Date.now(),
      subtype: "tool_use",
      toolInvocation: {
        toolCallId: "call-context-1",
        toolName: "Context",
        input: {
          action: "write",
          filename: "codebase.md",
        },
      },
    };
    const pairedResult: ChatMessage = {
      id: "tool-result-context-1",
      role: "tool",
      content: "Updated context codebase.md.",
      timestamp: Date.now(),
      subtype: "tool_result",
      toolResult: {
        toolCallId: "call-context-1",
        toolName: "Context",
        input: {
          action: "write",
          filename: "codebase.md",
        },
        outputText: "Updated context codebase.md.",
        display: {
          kind: "input_output",
          title: "codebase.md",
          subtitle: "updated",
          input: JSON.stringify({
            action: "write",
            filename: "codebase.md",
          }),
          output: "Updated context codebase.md.",
        },
      },
    };

    const { container } = render(
      <ToolMessageRenderer message={message} pairedResult={pairedResult} />,
    );

    expect(container.querySelector(".lucide-shapes")).not.toBeNull();
  });

  it("renders explicit block write labels with the cuboid icon", () => {
    const message: ChatMessage = {
      id: "tool-use-1",
      role: "assistant",
      content: 'Block({"action":"write","block_id":"payments"})',
      timestamp: Date.now(),
      subtype: "tool_use",
      toolInvocation: {
        toolCallId: "call-1",
        toolName: "Block",
        input: {
          action: "write",
          block_id: "payments",
        },
      },
    };
    const pairedResult: ChatMessage = {
      id: "tool-result-1",
      role: "tool",
      content: "Updated block payments.",
      timestamp: Date.now(),
      subtype: "tool_result",
      toolResult: {
        toolCallId: "call-1",
        toolName: "Block",
        input: {
          action: "write",
          block_id: "payments",
        },
        outputText: "Updated block payments.",
        display: {
          kind: "json",
          title: "payments",
          value: {
            id: "payments",
            title: "Payments",
          },
        },
      },
    };

    const { container } = render(
      <ToolMessageRenderer message={message} pairedResult={pairedResult} />,
    );

    expect(screen.getByText("Write Block: payments")).toBeDefined();
    expect(container.querySelector(".lucide-cuboid")).not.toBeNull();
  });

  it("renders explicit block read labels", () => {
    const message: ChatMessage = {
      id: "tool-use-2",
      role: "assistant",
      content: 'Block({"action":"read","block_id":"search"})',
      timestamp: Date.now(),
      subtype: "tool_use",
      toolInvocation: {
        toolCallId: "call-2",
        toolName: "Block",
        input: {
          action: "read",
          block_id: "search",
        },
      },
    };
    const pairedResult: ChatMessage = {
      id: "tool-result-2",
      role: "tool",
      content: "Read block search.",
      timestamp: Date.now(),
      subtype: "tool_result",
      toolResult: {
        toolCallId: "call-2",
        toolName: "Block",
        input: {
          action: "read",
          block_id: "search",
        },
        outputText: "Read block search.",
        display: {
          kind: "json",
          title: "search",
          value: {
            id: "search",
            title: "Search",
          },
        },
      },
    };

    render(<ToolMessageRenderer message={message} pairedResult={pairedResult} />);

    expect(screen.getByText("Read Block: search")).toBeDefined();
  });
});
