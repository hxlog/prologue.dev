"use client";

import { Fragment } from "react";
import { Dialog, DialogPanel, Transition, TransitionChild } from "@headlessui/react";

/**
 * Shared glass modal. Headless UI Dialog gives us accessible behavior for
 * free: closes on outside click and Escape, traps focus, and is announced as
 * a dialog. The visual language matches the design system (.modal-panel).
 *
 * @param {boolean} open
 * @param {() => void} onClose
 * @param {string} [title]      small heading shown under the gradient hairline
 * @param {React.ReactNode} children
 */
export default function Modal({ open, onClose, title, children }) {
  return (
    <Transition appear show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        {/* Backdrop */}
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
            aria-hidden="true"
          />
        </TransitionChild>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95 translate-y-2"
              enterTo="opacity-100 scale-100 translate-y-0"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100 translate-y-0"
              leaveTo="opacity-0 scale-95 translate-y-2"
            >
              <DialogPanel className="modal-panel w-full max-w-md p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    {title && (
                      <>
                        <Dialog.Title
                          as="h3"
                          className="text-base font-semibold text-foreground"
                        >
                          {title}
                        </Dialog.Title>
                        <div
                          className="mt-2 h-px w-10 rounded-full"
                          style={{ background: "var(--gradient-brand)" }}
                          aria-hidden="true"
                        />
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="关闭"
                    className="shrink-0 rounded-full p-1.5 text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                      className="h-4 w-4"
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="mt-4">{children}</div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
