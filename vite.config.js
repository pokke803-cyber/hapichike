import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        parent: "parent/index.html",
        parentSetPassword: "parent/set-password.html",
      },
    },
  },
});
