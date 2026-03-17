import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      closeButton
      richColors
      toastOptions={{
        classNames: {
          toast: "border border-border bg-card text-foreground shadow-2xl",
          title: "text-sm font-semibold text-foreground",
          description: "text-sm text-muted-foreground",
          actionButton: "bg-primary text-primary-foreground",
          cancelButton: "bg-muted text-foreground",
          error: "border-destructive/40",
          success: "border-emerald-400/40",
          warning: "border-amber-300/40",
          info: "border-border",
        },
      }}
      {...props}
    />
  );
}
