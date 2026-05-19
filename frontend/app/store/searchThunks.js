import {
  setSearchQuery,
  setSearchStatus,
  setSearchResults,
  setMessages,
  setMessagesStatus,
} from "./uiSlice";
import { search } from "../lib/searchService";
import { fetchMessages } from "../lib/messagesService";

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
      dispatch(setMessages(items));
    } catch {
      dispatch(setMessagesStatus("error"));
    }
  };
}
