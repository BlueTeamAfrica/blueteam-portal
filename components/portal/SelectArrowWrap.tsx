"use client";

import { Children, cloneElement, isValidElement } from "react";

export function SelectArrowWrap({ children }: { children: React.ReactNode }) {
  // Enforce "single arrow" across browsers:
  // - hide the native select arrow (appearance-none)
  // - keep a consistent right padding for the custom chevron
  const onlyChild = Children.only(children);
  let selectNode = onlyChild;

  if (
    isValidElement(onlyChild) &&
    typeof onlyChild.type === "string" &&
    onlyChild.type === "select"
  ) {
    const existingClassName = (onlyChild.props as { className?: string }).className ?? "";
    const mergedClassName = [
      existingClassName,
      "appearance-none",
      "[-webkit-appearance:none]",
      "[-moz-appearance:none]",
      // Ensure the custom chevron has space so it doesn't overlap the select value.
      "pr-9",
    ]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    selectNode = cloneElement(onlyChild, { className: mergedClassName });
  }

  return (
    <div className="relative w-full">
      {selectNode}
      <span
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
        aria-hidden
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </span>
    </div>
  );
}
