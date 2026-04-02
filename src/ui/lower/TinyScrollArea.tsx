import * as React from "react";
import SimpleBar from "simplebar-react";

import { cn } from "@/lib/utils";

interface TinyScrollAreaProps
  extends Omit<React.ComponentProps<typeof SimpleBar>, "children"> {
  children: React.ReactNode;
  contentClassName?: string;
  direction?: "vertical" | "horizontal" | "both";
}

export function TinyScrollArea({
  children,
  className,
  contentClassName,
  direction = "vertical",
  scrollableNodeProps,
  forceVisible,
  ...props
}: TinyScrollAreaProps) {
  const resolvedForceVisible =
    forceVisible ??
    (direction === "horizontal"
      ? "x"
      : direction === "vertical"
        ? "y"
        : true);

  return (
    <SimpleBar
      autoHide={false}
      forceVisible={resolvedForceVisible}
      className={cn("tiny-scroll-area", className)}
      scrollableNodeProps={{
        ...scrollableNodeProps,
        className: cn(
          "tiny-scroll-area__node",
          direction === "horizontal" && "overflow-y-hidden",
          direction === "vertical" && "overflow-x-hidden",
          scrollableNodeProps?.className,
        ),
      }}
      {...props}
    >
      <div className={contentClassName}>{children}</div>
    </SimpleBar>
  );
}
