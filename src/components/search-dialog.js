"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogPanel, Transition, TransitionChild } from "@headlessui/react";
import { useRouter } from "next/navigation";

/**
 * Site-wide search dialog.
 *
 * Interaction: ⌘K / Ctrl+K toggles it, "/" opens it when the reader is not in a
 * field, Esc / a click outside closes it (Headless UI Dialog owns focus trap,
 * scroll lock, inert background and outside-click). Results come from
 * /api/search, which runs Fuse on the server over the build-time corpus — the
 * client never downloads the index.
 *
 * The dialog is always mounted but its panel is only rendered while open, so a
 * reader who never searches pays for the trigger button and this module only.
 */

const DEBOUNCE_MS = 160;
const MIN_QUERY = 2;

export default function SearchDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const [active, setActive] = useState(0);
  const [took, setTook] = useState(0);
  const [retryToken, setRetryToken] = useState(0);

  const inputRef = useRef(null);
  const listRef = useRef(null);
  const abortRef = useRef(null);

  const openRef = useRef(false);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setQuery("");
    setResults([]);
    setStatus("idle");
    setActive(0);
    setTook(0);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    openRef.current = false;
    reset();
  }, [reset]);

  const openDialog = useCallback(() => {
    setOpen(true);
    openRef.current = true;
  }, []);

  /* Open shortcuts. "/" is ignored while typing so it stays a character in the
     search box and in the Giscus iframe's text fields. */
  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const typing =
        target instanceof Element &&
        target.closest(
          "input, textarea, select, [contenteditable='true'], [contenteditable='']"
        );
      const key = event.key.toLowerCase();

      if (key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (openRef.current) close();
        else openDialog();
        return;
      }
      if (
        event.key === "/" &&
        !typing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        openDialog();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, openDialog]);

  /* Debounced query. Old results stay on screen while loading (dimmed) so the
     panel does not flash empty on every keystroke; the 2px progress line is the
     only "busy" signal.

     Every state write happens inside the timer callback or a fetch continuation,
     never synchronously in the effect body: that is both what the React compiler
     lint requires and what keeps typing from cascading renders. */
  useEffect(() => {
    if (!open) return undefined;
    const q = query.trim();
    const delay = q.length < MIN_QUERY ? 0 : DEBOUNCE_MS;

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      abortRef.current = null;

      if (q.length < MIN_QUERY) {
        setResults([]);
        setStatus("idle");
        setTook(0);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("loading");

      fetch("/api/search?q=" + encodeURIComponent(q), {
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) throw new Error("search failed");
          return response.json();
        })
        .then((data) => {
          if (controller.signal.aborted) return;
          setResults(Array.isArray(data.results) ? data.results : []);
          setTook(data.took || 0);
          setStatus("ready");
          setActive(0);
        })
        .catch((error) => {
          if (error.name === "AbortError") return;
          setStatus("error");
        });
    }, delay);

    return () => clearTimeout(timer);
  }, [open, query, retryToken]);

  /* Headless UI only applies initialFocus on mount. Reopening during the leave
     transition reuses the same Dialog, so put the caret back in the field by
     hand — otherwise the second open has focus on <body> and typing is lost. */
  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  /* Keep the active row in view while arrowing through a long list. */
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector('[data-active="true"]');
    row?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const go = useCallback(
    (result) => {
      if (!result) return;
      close();
      router.push(result.href);
    },
    [close, router]
  );

  const onInputKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(results[active]);
    }
  };

  const posts = results.filter((result) => result.type === "post");
  const pages = results.filter((result) => result.type === "page");
  const loading = status === "loading";
  const showSkeleton = loading && results.length === 0;

  return (
    <>
      <button
        type="button"
        className="btn-icon"
        aria-label="搜索全站（⌘K）"
        aria-haspopup="dialog"
        onClick={openDialog}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.7}
          stroke="currentColor"
          className="h-[18px] w-[18px]"
          aria-hidden="true"
        >
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path strokeLinecap="round" d="m16 16 4.5 4.5" />
        </svg>
      </button>

      <Transition appear show={open} as={Fragment}>
        <Dialog
          as="div"
          className="search-dialog"
          onClose={close}
          initialFocus={inputRef}
          aria-label="搜索全站"
        >
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="search-dialog-backdrop" aria-hidden="true" />
          </TransitionChild>

          <div className="search-dialog-viewport">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 translate-y-1"
              enterTo="opacity-100 translate-y-0"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 translate-y-0"
              leaveTo="opacity-0 translate-y-1"
            >
              <DialogPanel className="search-dialog-panel">
                <div className="search-dialog-topline" aria-hidden="true" />

                <div className="search-dialog-input">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.6}
                    stroke="currentColor"
                    className="h-[18px] w-[18px] shrink-0 text-faint"
                    aria-hidden="true"
                  >
                    <circle cx="10.5" cy="10.5" r="6.5" />
                    <path strokeLinecap="round" d="m16 16 4.5 4.5" />
                  </svg>
                  <input
                    ref={inputRef}
                    id="site-search"
                    name="q"
                    type="search"
                    role="combobox"
                    aria-expanded="true"
                    aria-controls="site-search-results"
                    aria-autocomplete="list"
                    autoComplete="off"
                    spellCheck={false}
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setActive(0);
                    }}
                    onKeyDown={onInputKeyDown}
                    placeholder="搜索文章与页面…"
                  />
                  <span className="hidden sm:inline-flex">
                    <kbd>esc</kbd>
                  </span>
                </div>

                <div
                  className="search-dialog-progress"
                  data-active={loading ? "true" : undefined}
                  aria-hidden="true"
                />

                <div
                  ref={listRef}
                  id="site-search-results"
                  className="search-dialog-body"
                  data-loading={loading || undefined}
                  role="listbox"
                  aria-label="搜索结果"
                  aria-live="polite"
                >
                  {showSkeleton ? (
                    <div className="search-skeleton" aria-hidden="true">
                      {[0, 1, 2].map((row) => (
                        <div key={row} className="search-skeleton-row">
                          <div className="search-skeleton-line w-1/3" />
                          <div className="search-skeleton-line w-11/12" />
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {posts.length > 0 ? (
                    <>
                      <p className="search-dialog-group">
                        文章 <em>{posts.length}</em>
                      </p>
                      {posts.map((result, index) => (
                        <ResultRow
                          key={result.href}
                          result={result}
                          active={active === index}
                          onHover={() => setActive(index)}
                          onSelect={() => go(result)}
                        />
                      ))}
                    </>
                  ) : null}

                  {pages.length > 0 ? (
                    <>
                      <p className="search-dialog-group">
                        页面 <em>{pages.length}</em>
                      </p>
                      {pages.map((result, index) => {
                        const rowIndex = posts.length + index;
                        return (
                          <ResultRow
                            key={result.href}
                            result={result}
                            active={active === rowIndex}
                            onHover={() => setActive(rowIndex)}
                            onSelect={() => go(result)}
                          />
                        );
                      })}
                    </>
                  ) : null}

                  {status === "ready" && results.length === 0 ? (
                    <div className="search-dialog-empty">
                      <b>没有找到「{query.trim()}」</b>
                      试试更短的关键词，或只搜文章标题里的词。
                    </div>
                  ) : null}

                  {status === "error" ? (
                    <div className="search-dialog-empty">
                      <b>搜索服务暂时没有响应</b>
                      你的输入还在，重试一次即可。
                      <div>
                        <button
                          type="button"
                          className="search-dialog-retry"
                          onClick={() => setRetryToken((token) => token + 1)}
                        >
                          重试
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {status === "idle" ? (
                    <div className="search-dialog-hint">
                      输入至少 {MIN_QUERY} 个字符，搜索标题、正文与标签。
                    </div>
                  ) : null}
                </div>

                <div className="search-dialog-foot">
                  <span className="search-dialog-key inline-flex">
                    <kbd>↑</kbd>
                    <kbd>↓</kbd> 选择
                  </span>
                  <span className="search-dialog-key hidden sm:inline-flex">
                    <kbd>↵</kbd> 打开
                  </span>
                  <span className="search-dialog-key hidden sm:inline-flex">
                    <kbd>esc</kbd> 关闭
                  </span>
                  <span className="search-dialog-count">
                    {status === "ready"
                      ? "共 " + results.length + " 条结果 · " + took + "ms"
                      : loading
                        ? "搜索中…"
                        : "站点全文搜索"}
                  </span>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>
    </>
  );
}

function ResultRow({ result, active, onHover, onSelect }) {
  const meta =
    result.type === "page"
      ? "页面"
      : [result.date, result.read].filter(Boolean).join(" · ");

  return (
    <a
      href={result.href}
      className="search-result"
      data-kind={result.type}
      data-active={active ? "true" : undefined}
      role="option"
      aria-selected={active ? "true" : undefined}
      onMouseEnter={onHover}
      onClick={(event) => {
        /* Keep modified clicks (open in a new tab, copy link) native. */
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        event.preventDefault();
        onSelect();
      }}
    >
      <span className="search-result-dot" aria-hidden="true" />
      <span className="search-result-title">{result.title}</span>
      <span className="search-result-snippet">
        {result.snippet.map((part, index) =>
          part.hit ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>
        )}
      </span>
      <span className="search-result-meta">{meta}</span>
    </a>
  );
}
