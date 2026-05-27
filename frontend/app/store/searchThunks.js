import {
  setSearchQuery,
  setSearchStatus,
  setSearchResults,
  setMessages,
  setMessagesStatus,
  markMessageRead,
  markAllMessagesRead,
} from "./uiSlice";
import { search } from "../lib/searchService";
import { fetchMessages } from "../lib/messagesService";
import { addReadId, addReadIds, getReadIds } from "../lib/notificationsReadStore";

let searchTimer = null;
let searchSeq = 0;

// Debounced search. Dispatch on every keystroke; only the last query (after
// 300ms idle) hits the service, and stale responses are discarded.
export function searchThunk(query) {
  return (dispatch) => {
    dispatch(setSearchQuery(query));
    if (searchTimer) clearTimeout(searchTimer);

    if (!query.trim()) {
      searchSeq += 1;
      dispatch(setSearchResults([]));
      dispatch(setSearchStatus("idle"));
      return;
    }

    dispatch(setSearchStatus("loading"));
    const seq = ++searchSeq;
    searchTimer = setTimeout(async () => {
      try {
        const results = await search(query);
        if (seq === searchSeq) dispatch(setSearchResults(results));
      } catch {
        if (seq === searchSeq) dispatch(setSearchStatus("error"));
      }
    }, 300);
  };
}

export function loadMessagesThunk() {
  return async (dispatch) => {
    dispatch(setMessagesStatus("loading"));
    try {
      const items = await fetchMessages();
      // Merge the localStorage "seen" set so notifications that were
      // marked read in a previous session don't bounce back as unread
      // when the user re-signs in.
      const readIds = getReadIds();
      const merged = (items || []).map((m) => ({
        ...m,
        read: Boolean(m.read) || readIds.has(m.id),
      }));
      dispatch(setMessages(merged));
    } catch {
      dispatch(setMessagesStatus("error"));
    }
  };
}

// Wrappers around the reducer actions that also persist the "seen"
// state to localStorage. Components should call these instead of
// dispatching markMessageRead / markAllMessagesRead directly.
export function markMessageReadThunk(id) {
  return (dispatch) => {
    dispatch(markMessageRead(id));
    addReadId(id);
  };
}

export function markAllMessagesReadThunk() {
  return (dispatch, getState) => {
    const ids = getState().ui.messages.items.map((m) => m.id).filter(Boolean);
    dispatch(markAllMessagesRead());
    addReadIds(ids);
  };
}
