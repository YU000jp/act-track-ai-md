type Listener = () => void;

class MockClassList {
  private readonly classes = new Set<string>();

  constructor(initial?: string) {
    if (initial) {
      for (const part of initial.split(/\s+/)) {
        const value = part.trim();
        if (value) {
          this.classes.add(value);
        }
      }
    }
  }

  add(name: string): void {
    this.classes.add(name);
  }

  remove(name: string): void {
    this.classes.delete(name);
  }

  contains(name: string): boolean {
    return this.classes.has(name);
  }

  toString(): string {
    return Array.from(this.classes).join(" ");
  }
}

class MockElement {
  public id = "";
  public dataset: Record<string, string> = {};
  public classList = new MockClassList();
  public children: MockElement[] = [];
  public parent: MockElement | null = null;
  private listeners = new Map<string, Listener[]>();
  private html = "";
  private text = "";

  constructor(public tagName: string, private readonly owner: MockDocument) {}

  setAttribute(name: string, value: string): void {
    if (name === "id") {
      this.id = value;
      this.owner.registerId(value, this);
      return;
    }

    if (name === "class") {
      this.classList = new MockClassList(value);
      return;
    }

    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[key] = value;
    }
  }

  appendChild(child: MockElement): void {
    child.parent = this;
    this.children.push(child);
  }

  addEventListener(type: string, listener: Listener): void {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  click(): void {
    for (const listener of this.listeners.get("click") ?? []) {
      listener();
    }
  }

  set innerHTML(value: string) {
    this.html = value;
    this.children = [];
    this.text = value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    if (this.tagName === "BODY") {
      this.owner.resetIndex();
      this.owner.parseApp(value);
    }
  }

  get innerHTML(): string {
    return this.html;
  }

  get textContent(): string {
    if (this.children.length > 0) {
      return this.children.map((child) => child.textContent).join(" ").trim();
    }
    return this.text;
  }

  querySelector(selector: string): MockElement | null {
    const results = this.querySelectorAll(selector);
    return results[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    if (selector === "input") {
      const count = (this.html.match(/<input\b/gi) ?? []).length;
      return Array.from({ length: count }, () => new MockElement("INPUT", this.owner));
    }

    if (selector.startsWith("#")) {
      const id = selector.slice(1);
      const item = this.owner.getElementById(id);
      return item ? [item] : [];
    }

    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      const output: MockElement[] = [];
      const walk = (node: MockElement): void => {
        for (const child of node.children) {
          if (child.classList.contains(className)) {
            output.push(child);
          }
          walk(child);
        }
      };
      walk(this);
      return output;
    }

    return [];
  }
}

class MockDocument {
  public body = new MockElement("BODY", this);
  private ids = new Map<string, MockElement>();

  createElement(tagName: string): MockElement {
    return new MockElement(tagName.toUpperCase(), this);
  }

  appendChild(node: MockElement): void {
    this.body.appendChild(node);
  }

  getElementById(id: string): MockElement | null {
    return this.ids.get(id) ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    return this.body.querySelectorAll(selector);
  }

  registerId(id: string, element: MockElement): void {
    this.ids.set(id, element);
  }

  resetIndex(): void {
    this.ids.clear();
    this.registerId("body", this.body);
  }

  parseApp(html: string): void {
    const appMatch = html.match(/<div[^>]*id="app"[^>]*>/i);
    if (!appMatch) {
      return;
    }

    const app = this.createElement("div");
    app.setAttribute("id", "app");

    const buttonRegex = /<button([^>]*)>/gi;
    for (const match of html.matchAll(buttonRegex)) {
      const attrs = match[1] ?? "";
      const button = this.createElement("button");
      const classValue = attrs.match(/class="([^"]+)"/i)?.[1];
      const tabValue = attrs.match(/data-tab="([^"]+)"/i)?.[1];
      if (classValue) {
        button.setAttribute("class", classValue);
      }
      if (tabValue) {
        button.setAttribute("data-tab", tabValue);
      }
      app.appendChild(button);
    }

    const sectionRegex = /<section([^>]*)>/gi;
    for (const match of html.matchAll(sectionRegex)) {
      const attrs = match[1] ?? "";
      const section = this.createElement("section");
      const classValue = attrs.match(/class="([^"]+)"/i)?.[1];
      const idValue = attrs.match(/id="([^"]+)"/i)?.[1];
      if (classValue) {
        section.setAttribute("class", classValue);
      }
      if (idValue) {
        section.setAttribute("id", idValue);
      }
      app.appendChild(section);
    }

    this.body.appendChild(app);
  }
}

const documentInstance = new MockDocument();

Object.assign(globalThis, {
  document: documentInstance,
  HTMLElement: MockElement,
});

export {};
