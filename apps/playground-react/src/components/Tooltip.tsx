import { cloneElement, type ReactElement, type ReactNode, useId } from "react";

type TooltipProps = {
  label: ReactNode;
  children: ReactElement<{ "aria-describedby"?: string }>;
  align?: "center" | "end";
  className?: string;
};

export function Tooltip({ label, children, align = "center", className }: TooltipProps) {
  const tooltipId = useId();
  const existingDescription = children.props["aria-describedby"];
  const describedBy = existingDescription ? `${existingDescription} ${tooltipId}` : tooltipId;

  return (
    <span className={`playground-tooltip align-${align}${className ? ` ${className}` : ""}`}>
      {cloneElement(children, { "aria-describedby": describedBy })}
      <span id={tooltipId} className="playground-tooltip-content" role="tooltip">
        {label}
      </span>
    </span>
  );
}
