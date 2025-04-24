import { Service, Method, FunctionNode } from "./index";

export type BaseNode = {
  id: string;
  name: string;
};


export type Node = Service | Method | FunctionNode;

export type NodeWithCount = Node & {
  count: number;
};

export type NodeWithSpeed = Node & {
  speed?: string;
  argpos?: number;
  duration?: number;
  size?: number;
};

export type FoldedSections = {
  Methods: boolean;
  Devices: boolean;
  Callers: boolean;
  Callees: boolean;
  "Data Dependencies": boolean;
};