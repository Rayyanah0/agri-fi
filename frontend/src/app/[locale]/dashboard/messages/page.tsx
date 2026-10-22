"use client";

import {
  BarChart3,
  CheckCheck,
  FileText,
  MessageCircle,
  Paperclip,
  Plus,
  Reply,
  Search,
  Send,
  Users,
  X,
} from "lucide-react";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { io, Socket } from "socket.io-client";
import {
  API_BASE,
  apiClient,
  ChatAnalytics,
  ChatConversation,
  ChatMessage,
  getStoredToken,
  User,
} from "@/lib/api";
import { useToast } from "@/components/ui/ToastProvider";
import { useRouter } from "next/navigation";
import DashboardLayout from "@/components/DashboardLayout";

const REACTIONS = ["👍", "❤️", "😂", "🎉", "🙏", "👀"];

function countLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return Math.max(0, Math.trunc(value)).toLocaleString("en-US");
}

function messageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function conversationTitle(
  conversation: ChatConversation,
  currentUserId?: string,
) {
  if (conversation.name) return conversation.name;
  const names = conversation.participants
    .filter((participant) => participant.userId !== currentUserId)
    .map((participant) => participant.email)
    .filter(Boolean);
  return names.join(", ") || "Conversation";
}

export default function MessagesPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [analytics, setAnalytics] = useState<ChatAnalytics | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [error, setError] = useState("");
  const [messageError, setMessageError] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [contactQuery, setContactQuery] = useState("");
  const [contacts, setContacts] = useState<
    Array<{ id: string; email: string; role: string }>
  >([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [dealId, setDealId] = useState("");
  const [creating, setCreating] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  const refreshConversations = useCallback(async () => {
    const result = await apiClient.getChatConversations();
    setConversations(result);
    return result;
  }, []);

  useEffect(() => {
    const cached = apiClient.getCurrentUser();
    if (!cached) {
      router.replace("/login");
      return;
    }
    setUser(cached);
    setCurrentUserId(cached.id);
    setAuthReady(true);
  }, [router]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (!authReady) return;
    let alive = true;
    setLoading(true);
    setError("");
    Promise.all([refreshConversations(), apiClient.getChatAnalytics()])
      .then(([items, activity]) => {
        if (!alive) return;
        setAnalytics(activity);
        if (!selectedIdRef.current && items.length) setSelectedId(items[0].id);
      })
      .catch((reason: unknown) => {
        if (alive)
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load messages",
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [authReady, refreshConversations]);

  useEffect(() => {
    if (!authReady) return;
    const token = getStoredToken();
    if (!token) return;
    const socket = io(`${API_BASE}/chat`, {
      auth: { token },
      transports: ["websocket"],
      reconnection: true,
    });
    socketRef.current = socket;
    socket.on("connect", () => setSocketConnected(true));
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("connect_error", () => setSocketConnected(false));
    socket.on("message_created", (message: ChatMessage) => {
      if (message.conversationId === selectedIdRef.current) {
        setMessages((current) =>
          current.some((item) => item.id === message.id)
            ? current
            : [...current, message],
        );
        if (message.senderId !== currentUserId) {
          void apiClient.markChatRead(message.conversationId);
        }
      }
      void refreshConversations();
    });
    socket.on("message_updated", (message: ChatMessage) => {
      setMessages((current) =>
        current.map((item) => (item.id === message.id ? message : item)),
      );
    });
    socket.on("read_updated", () => {
      void refreshConversations();
      const activeId = selectedIdRef.current;
      if (activeId) void apiClient.getChatMessages(activeId).then(setMessages);
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [authReady, currentUserId, refreshConversations]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    let alive = true;
    setMessagesLoading(true);
    setMessageError("");
    const request =
      query.trim().length >= 2
        ? apiClient.searchChatMessages(selectedId, query.trim())
        : apiClient.getChatMessages(selectedId);
    request
      .then((result) => {
        if (alive) setMessages(result);
      })
      .catch((reason: unknown) => {
        if (alive)
          setMessageError(
            reason instanceof Error
              ? reason.message
              : "Unable to load this conversation",
          );
      })
      .finally(() => {
        if (alive) setMessagesLoading(false);
      });
    if (query.trim().length < 2) {
      void apiClient
        .markChatRead(selectedId)
        .then(() => refreshConversations());
      socketRef.current?.emit("join_conversation", selectedId);
    }
    return () => {
      alive = false;
    };
  }, [selectedId, query, refreshConversations]);

  useEffect(() => {
    if (!showCreate || contactQuery.trim().length < 2) {
      setContacts([]);
      setContactsLoading(false);
      return;
    }
    let alive = true;
    setContactsLoading(true);
    const timer = window.setTimeout(() => {
      apiClient
        .searchChatContacts(contactQuery.trim())
        .then((result) => {
          if (alive) setContacts(result);
        })
        .catch((reason: unknown) => {
          if (alive)
            setFormError(
              reason instanceof Error
                ? reason.message
                : "Unable to search users",
            );
        })
        .finally(() => {
          if (alive) setContactsLoading(false);
        });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [showCreate, contactQuery]);

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    messageEndRef.current?.scrollIntoView({
      block: "end",
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [messages]);

  const selectedConversation = useMemo(
    () =>
      conversations.find((conversation) => conversation.id === selectedId) ??
      null,
    [conversations, selectedId],
  );

  const updateMessage = (updated: ChatMessage) => {
    setMessages((current) =>
      current.map((message) => (message.id === updated.id ? updated : message)),
    );
  };

  const submitMessage = async (event: FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!selectedId || !content || sending) return;
    setSending(true);
    setMessageError("");
    try {
      const sent = await apiClient.sendChatMessage(
        selectedId,
        content,
        replyTo?.id,
      );
      setMessages((current) =>
        current.some((message) => message.id === sent.id)
          ? current
          : [...current, sent],
      );
      setDraft("");
      setReplyTo(null);
      await refreshConversations();
    } catch (reason) {
      setMessageError(
        reason instanceof Error ? reason.message : "Message could not be sent",
      );
    } finally {
      setSending(false);
    }
  };

  const createConversation = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedContacts.length || creating) return;
    setCreating(true);
    setFormError("");
    try {
      const conversation = await apiClient.createChatConversation({
        participantIds: selectedContacts,
        ...(groupName.trim() ? { name: groupName.trim() } : {}),
        ...(dealId.trim() ? { dealId: dealId.trim() } : {}),
      });
      setShowCreate(false);
      setContactQuery("");
      setSelectedContacts([]);
      setGroupName("");
      setDealId("");
      const updated = await refreshConversations();
      setSelectedId(conversation.id);
      if (!updated.some((item) => item.id === conversation.id)) {
        setConversations((current) => [conversation, ...current]);
      }
    } catch (reason) {
      setFormError(
        reason instanceof Error
          ? reason.message
          : "Conversation could not be created",
      );
    } finally {
      setCreating(false);
    }
  };

  const uploadFile = async (file?: File) => {
    if (!file || !selectedId || uploading) return;
    setUploading(true);
    setMessageError("");
    try {
      const uploaded = await apiClient.uploadChatAttachment(selectedId, file);
      setMessages((current) =>
        current.some((message) => message.id === uploaded.id)
          ? current
          : [...current, uploaded],
      );
      await refreshConversations();
    } catch (reason) {
      setMessageError(
        reason instanceof Error ? reason.message : "File could not be shared",
      );
    } finally {
      setUploading(false);
    }
  };

  const downloadFile = async (downloadUrl: string, fileName: string) => {
    try {
      const blob = await apiClient.downloadChatAttachment(downloadUrl);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (reason) {
      toast(
        reason instanceof Error ? reason.message : "File download failed",
        "error",
      );
    }
  };

  if (!user) {
    return (
      <div
        className="flex min-h-64 items-center justify-center text-sm text-slate-600 dark:text-slate-300"
        aria-busy="true"
      >
        Loading your inbox…
      </div>
    );
  }

  return (
    <DashboardLayout user={user}>
      <div className="page-content space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-sm text-slate-500 dark:text-slate-400">
              Team communication
            </p>
            <h1 className="page-title">Messages</h1>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate((visible) => !visible)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
            aria-expanded={showCreate}
          >
            {showCreate ? (
              <X size={18} aria-hidden="true" />
            ) : (
              <Plus size={18} aria-hidden="true" />
            )}
            {showCreate ? "Close" : "New conversation"}
          </button>
        </header>

        {analytics && (
          <section
            aria-label="Messaging activity"
            className="grid grid-cols-2 gap-3 md:grid-cols-4"
          >
            {[
              {
                label: "Conversations",
                value: analytics.conversationCount,
                icon: Users,
              },
              { label: "Sent · 30 days", value: analytics.sent, icon: Send },
              {
                label: "Received · 30 days",
                value: analytics.received,
                icon: MessageCircle,
              },
              {
                label: "Active days",
                value: analytics.dailyActivity.length,
                icon: BarChart3,
              },
            ].map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-600 dark:text-slate-300">
                    {label}
                  </span>
                  <Icon
                    size={17}
                    className="text-slate-500"
                    aria-hidden="true"
                  />
                </div>
                <p className="mt-3 font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-100">
                  {countLabel(value)}
                </p>
              </div>
            ))}
          </section>
        )}

        {error && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-10 rounded-md px-3 font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
            >
              Retry
            </button>
          </div>
        )}

        {showCreate && (
          <section
            className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
            aria-labelledby="new-conversation-title"
          >
            <div className="mb-4 flex items-center gap-2">
              <Users size={18} aria-hidden="true" />
              <h2
                id="new-conversation-title"
                className="font-semibold text-slate-900 dark:text-slate-100"
              >
                Start a conversation
              </h2>
            </div>
            <form
              onSubmit={createConversation}
              className="grid gap-4 lg:grid-cols-2"
            >
              {formError && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200 lg:col-span-2"
                >
                  {formError}
                </p>
              )}
              <div>
                <label
                  htmlFor="contact-search"
                  className="mb-1 block text-sm font-medium"
                >
                  Find team members
                </label>
                <input
                  id="contact-search"
                  type="search"
                  autoComplete="off"
                  value={contactQuery}
                  onChange={(event) => setContactQuery(event.target.value)}
                  placeholder="Search by email"
                  className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {contacts.map((contact) => (
                    <li key={contact.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-slate-50 dark:hover:bg-slate-800">
                        <input
                          type="checkbox"
                          checked={selectedContacts.includes(contact.id)}
                          onChange={(event) =>
                            setSelectedContacts((current) =>
                              event.target.checked
                                ? [...current, contact.id]
                                : current.filter((id) => id !== contact.id),
                            )
                          }
                          className="h-4 w-4 rounded border-slate-400 text-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-600"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {contact.email}
                        </span>
                        <span className="text-xs capitalize text-slate-500">
                          {contact.role.replace("_", " ")}
                        </span>
                      </label>
                    </li>
                  ))}
                  {contactsLoading && (
                    <li
                      className="px-2 py-3 text-sm text-slate-600 dark:text-slate-300"
                      aria-live="polite"
                    >
                      Searching team members…
                    </li>
                  )}
                  {!contactsLoading &&
                    contactQuery.trim().length >= 2 &&
                    contacts.length === 0 && (
                      <li className="px-2 py-3 text-sm text-slate-600 dark:text-slate-300">
                        No matching team members.
                      </li>
                    )}
                </ul>
              </div>
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="group-name"
                    className="mb-1 block text-sm font-medium"
                  >
                    Group name{" "}
                    <span className="font-normal text-slate-500">
                      (optional)
                    </span>
                  </label>
                  <input
                    id="group-name"
                    value={groupName}
                    onChange={(event) => setGroupName(event.target.value)}
                    maxLength={120}
                    autoComplete="off"
                    className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label
                    htmlFor="deal-id"
                    className="mb-1 block text-sm font-medium"
                  >
                    Related deal ID{" "}
                    <span className="font-normal text-slate-500">
                      (optional)
                    </span>
                  </label>
                  <input
                    id="deal-id"
                    value={dealId}
                    onChange={(event) => setDealId(event.target.value)}
                    autoComplete="off"
                    className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!selectedContacts.length || creating}
                  aria-busy={creating}
                  className="min-h-11 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {creating
                    ? "Creating…"
                    : `Create${selectedContacts.length ? ` · ${selectedContacts.length} selected` : ""}`}
                </button>
              </div>
            </form>
          </section>
        )}

        <div className="grid min-h-[34rem] overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:grid-cols-[19rem_minmax(0,1fr)]">
          <aside
            className="border-b border-slate-200 dark:border-slate-800 lg:border-b-0 lg:border-r"
            aria-label="Conversations"
          >
            <div className="flex items-center justify-between px-4 py-4">
              <h2 className="font-semibold text-slate-900 dark:text-slate-100">
                Inbox
              </h2>
              <span
                className={`rounded-full px-2 py-1 text-xs ${socketConnected ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}
              >
                {socketConnected ? "Live" : "Connecting"}
              </span>
            </div>
            {loading ? (
              <div
                className="space-y-2 px-3 pb-4"
                aria-label="Loading conversations"
                aria-busy="true"
              >
                {[0, 1, 2, 3].map((item) => (
                  <div
                    key={item}
                    className="h-16 animate-pulse motion-reduce:animate-none rounded-lg bg-slate-100 dark:bg-slate-800"
                  />
                ))}
              </div>
            ) : conversations.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <MessageCircle
                  size={24}
                  className="mx-auto text-slate-500"
                  aria-hidden="true"
                />
                <p className="mt-3 text-sm font-medium text-slate-800 dark:text-slate-100">
                  No conversations yet
                </p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Start one to coordinate with your team.
                </p>
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="mt-3 min-h-10 rounded-md px-3 text-sm font-semibold text-emerald-800 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:text-emerald-300"
                >
                  New conversation
                </button>
              </div>
            ) : (
              <ul className="max-h-[32rem] overflow-y-auto px-2 pb-2">
                {conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(conversation.id);
                        setQuery("");
                        setReplyTo(null);
                      }}
                      aria-current={
                        conversation.id === selectedId ? "true" : undefined
                      }
                      className={`flex min-h-[4.5rem] w-full items-start gap-3 rounded-lg px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600 ${conversation.id === selectedId ? "bg-emerald-50 dark:bg-emerald-950/50" : "hover:bg-slate-50 dark:hover:bg-slate-800"}`}
                    >
                      <span className="mt-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        {conversation.kind === "group" ? (
                          <Users size={17} aria-hidden="true" />
                        ) : (
                          <MessageCircle size={17} aria-hidden="true" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {conversationTitle(conversation, currentUserId)}
                        </span>
                        <span className="mt-1 block truncate text-xs text-slate-600 dark:text-slate-300">
                          {conversation.lastMessage?.content ??
                            (conversation.dealId
                              ? `Deal · ${conversation.dealId}`
                              : "No messages yet")}
                        </span>
                      </span>
                      {Boolean(conversation.unreadCount) && (
                        <span className="mt-1 min-w-5 rounded-full bg-emerald-700 px-1.5 py-0.5 text-center font-mono tabular-nums text-xs text-white">
                          {countLabel(conversation.unreadCount)}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <section
            className="flex min-h-[34rem] min-w-0 flex-col"
            aria-label="Message thread"
          >
            {selectedConversation ? (
              <>
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold text-slate-900 dark:text-slate-100">
                      {conversationTitle(selectedConversation, currentUserId)}
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      {selectedConversation.kind === "group"
                        ? `${selectedConversation.participants.length} members`
                        : "Direct message"}
                      {selectedConversation.dealId
                        ? ` · Deal ${selectedConversation.dealId}`
                        : ""}
                    </p>
                  </div>
                  <div className="relative w-full sm:w-56">
                    <Search
                      size={16}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                      aria-hidden="true"
                    />
                    <label htmlFor="message-search" className="sr-only">
                      Search this conversation
                    </label>
                    <input
                      id="message-search"
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search messages"
                      className="min-h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>
                </header>

                <div
                  className="flex-1 space-y-4 overflow-y-auto px-4 py-5"
                  aria-live="polite"
                >
                  {messageError && (
                    <div
                      role="alert"
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
                    >
                      {messageError}
                    </div>
                  )}
                  {messagesLoading ? (
                    <div
                      className="space-y-4"
                      aria-label="Loading messages"
                      aria-busy="true"
                    >
                      {[0, 1, 2].map((item) => (
                        <div
                          key={item}
                          className={`h-16 max-w-sm animate-pulse motion-reduce:animate-none rounded-xl bg-slate-100 dark:bg-slate-800 ${item % 2 ? "ml-auto" : ""}`}
                        />
                      ))}
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex h-full min-h-48 flex-col items-center justify-center text-center">
                      <MessageCircle
                        size={28}
                        className="text-slate-500"
                        aria-hidden="true"
                      />
                      <p className="mt-3 font-medium text-slate-900 dark:text-slate-100">
                        {query.trim().length >= 2
                          ? "No matching messages"
                          : "Start the conversation"}
                      </p>
                      <p className="mt-1 max-w-sm text-sm text-slate-600 dark:text-slate-300">
                        {query.trim().length >= 2
                          ? "Try a different search phrase."
                          : "Messages are encrypted before they are stored."}
                      </p>
                    </div>
                  ) : (
                    messages.map((message) => (
                      <article
                        key={message.id}
                        className={`flex ${message.senderId === currentUserId ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[min(88%,36rem)] rounded-xl border px-4 py-3 ${message.senderId === currentUserId ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"}`}
                        >
                          {message.senderId !== currentUserId && (
                            <p className="mb-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                              {message.senderEmail}
                            </p>
                          )}
                          {message.replyTo && (
                            <div className="mb-2 border-l-2 border-current/40 pl-2 text-xs opacity-80">
                              Replying to {message.replyTo.senderEmail}:{" "}
                              {message.replyTo.content}
                            </div>
                          )}
                          <p className="whitespace-pre-wrap break-words text-sm">
                            {message.content}
                          </p>
                          {message.attachments.map((attachment) => (
                            <button
                              key={attachment.id}
                              type="button"
                              onClick={() =>
                                void downloadFile(
                                  attachment.downloadUrl,
                                  attachment.fileName,
                                )
                              }
                              className="mt-3 flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-current/20 px-3 text-left text-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                            >
                              <FileText size={17} aria-hidden="true" />
                              <span className="truncate">
                                {attachment.fileName}
                              </span>
                              <span className="flex-shrink-0 font-mono tabular-nums text-xs opacity-80">
                                {countLabel(attachment.sizeBytes)} B
                              </span>
                            </button>
                          ))}
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                            <time
                              dateTime={message.createdAt}
                              className="font-mono tabular-nums opacity-80"
                            >
                              {messageTime(message.createdAt)}
                            </time>
                            <div className="flex items-center gap-1">
                              {message.senderId === currentUserId &&
                                message.readBy.length > 0 && (
                                  <CheckCheck size={14} aria-label="Read" />
                                )}
                              {message.senderId === currentUserId &&
                                message.readBy.length > 0 && <span>Seen</span>}
                              <button
                                type="button"
                                onClick={() => setReplyTo(message)}
                                className="ml-2 inline-flex min-h-9 items-center gap-1 rounded px-2 opacity-90 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
                                aria-label={`Reply to message from ${message.senderEmail ?? "you"}`}
                              >
                                <Reply size={14} aria-hidden="true" /> Reply
                              </button>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {REACTIONS.map((emoji) => {
                              const people = message.reactions[emoji] ?? [];
                              return (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={() =>
                                    apiClient
                                      .reactToChatMessage(message.id, emoji)
                                      .then(updateMessage)
                                      .catch((reason: unknown) =>
                                        setMessageError(
                                          reason instanceof Error
                                            ? reason.message
                                            : "Reaction failed",
                                        ),
                                      )
                                  }
                                  aria-label={`React ${emoji}${people.length ? `, ${people.length} reactions` : ""}`}
                                  className="min-h-9 min-w-9 rounded-md border border-current/20 px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
                                >
                                  {emoji}
                                  {people.length > 0 && (
                                    <span className="ml-1 font-mono tabular-nums">
                                      {countLabel(people.length)}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </article>
                    ))
                  )}
                  <div ref={messageEndRef} />
                </div>

                {replyTo && (
                  <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-2 text-sm dark:border-slate-800">
                    <span className="min-w-0 truncate">
                      Replying to: {replyTo.content}
                    </span>
                    <button
                      type="button"
                      onClick={() => setReplyTo(null)}
                      className="min-h-10 min-w-10 rounded-md p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                      aria-label="Cancel reply"
                    >
                      <X size={17} aria-hidden="true" />
                    </button>
                  </div>
                )}
                <form
                  onSubmit={submitMessage}
                  className="flex items-end gap-2 border-t border-slate-200 p-3 dark:border-slate-800"
                >
                  <label
                    className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-emerald-600 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    aria-label="Attach a file"
                  >
                    <Paperclip size={18} aria-hidden="true" />
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain"
                      className="sr-only"
                      onChange={(event) => {
                        void uploadFile(event.target.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                      disabled={uploading}
                    />
                  </label>
                  <label htmlFor="message-composer" className="sr-only">
                    Write a message
                  </label>
                  <textarea
                    id="message-composer"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    maxLength={8000}
                    rows={2}
                    placeholder={
                      uploading ? "Uploading file…" : "Write a message"
                    }
                    className="max-h-32 min-h-11 flex-1 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    disabled={uploading}
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim() || sending || uploading}
                    aria-busy={sending}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-emerald-700 px-3 text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Send message"
                  >
                    <Send size={18} aria-hidden="true" />
                  </button>
                </form>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
                <MessageCircle
                  size={30}
                  className="text-slate-500"
                  aria-hidden="true"
                />
                <h2 className="mt-3 font-semibold text-slate-900 dark:text-slate-100">
                  Your team inbox
                </h2>
                <p className="mt-1 max-w-sm text-sm text-slate-600 dark:text-slate-300">
                  Choose a conversation or start a direct or group chat.
                </p>
                {conversations.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedId(conversations[0].id)}
                    className="mt-4 min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:border-slate-700"
                  >
                    Open latest conversation
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
}
