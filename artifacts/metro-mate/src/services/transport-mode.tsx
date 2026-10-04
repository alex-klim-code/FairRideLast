import { createContext, useContext } from "react";
export const TransportModeContext = createContext<"demo" | "verified">("demo");
export const useTransportMode = () => useContext(TransportModeContext);