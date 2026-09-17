"use client";

import {
  cloneElement,
  isValidElement,
  useId,
  useState,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type TooltipSide = "top" | "right" | "bottom" | "left";
type TooltipAlign = "start" | "center" | "end";

type TriggerProps = {
  "aria-describedby"?: string;
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (event: PointerEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
};

type Position = {
  top: number;
  left: number;
  transform: string;
};

export function Tooltip({
  label,
  children,
  side = "bottom",
  align = "center",
}: {
  label?: string;
  children: ReactNode;
  side?: TooltipSide;
  align?: TooltipAlign;
}) {
  const id = useId();
  const [position, setPosition] = useState<Position | null>(null);

  if (!label || !isValidElement<TriggerProps>(children)) return children;

  const trigger = children as ReactElement<TriggerProps>;
  const show = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const gap = 6;
    let top = rect.bottom + gap;
    let left = rect.left + rect.width / 2;
    let transform = "translateX(-50%)";

    if (side === "top") {
      top = rect.top - gap;
      transform = "translate(-50%, -100%)";
    } else if (side === "right") {
      top = rect.top + rect.height / 2;
      left = rect.right + gap;
      transform = "translateY(-50%)";
    } else if (side === "left") {
      top = rect.top + rect.height / 2;
      left = rect.left - gap;
      transform = "translate(-100%, -50%)";
    } else if (align === "start") {
      left = rect.left;
      transform = "none";
    } else if (align === "end") {
      left = rect.right;
      transform = "translateX(-100%)";
    }

    setPosition({ top, left, transform });
  };

  const describedBy = [trigger.props["aria-describedby"], position ? id : undefined]
    .filter(Boolean)
    .join(" ");

  const enhancedTrigger = cloneElement(trigger, {
    "aria-describedby": describedBy || undefined,
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      trigger.props.onPointerEnter?.(event);
      show(event.currentTarget);
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      trigger.props.onPointerLeave?.(event);
      if (document.activeElement !== event.currentTarget) setPosition(null);
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      trigger.props.onFocus?.(event);
      show(event.currentTarget);
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      trigger.props.onBlur?.(event);
      setPosition(null);
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      // 激活按钮后提示已完成使命。尤其是按钮打开模态框时，触发器仍保持
      // hover/focus，若不主动收起，portal tooltip 会浮在遮罩上方。
      setPosition(null);
      trigger.props.onClick?.(event);
    },
  });

  return (
    <>
      {enhancedTrigger}
      {position &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className="app-tooltip"
            style={position}
          >
            {label}
          </span>,
          document.body,
        )}
    </>
  );
}
