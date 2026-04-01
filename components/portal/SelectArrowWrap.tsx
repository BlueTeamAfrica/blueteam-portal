"use client";

export function SelectArrowWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative w-full">
      {children}
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
