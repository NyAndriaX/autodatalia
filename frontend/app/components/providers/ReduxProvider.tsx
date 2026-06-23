"use client";

import { Provider } from "react-redux";
import { store } from "../../store";
import AppBootstrap from "./AppBootstrap";
import AntdProvider from "./AntdProvider";

export default function ReduxProvider({ children }) {
  return (
    <Provider store={store}>
      <AntdProvider>
        <AppBootstrap />
        {children}
      </AntdProvider>
    </Provider>
  );
}
