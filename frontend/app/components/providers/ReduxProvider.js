"use client";

import { Provider } from "react-redux";
import { store } from "../../store";
import AppBootstrap from "./AppBootstrap";

export default function ReduxProvider({ children }) {
  return (
    <Provider store={store}>
      <AppBootstrap />
      {children}
    </Provider>
  );
}
