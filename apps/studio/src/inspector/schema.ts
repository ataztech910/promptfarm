import { z } from "zod";

export const InspectorFieldSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

export const InspectorFormSchema = z.object({
  fields: z.array(InspectorFieldSchema),
});

export type InspectorFormValues = z.infer<typeof InspectorFormSchema>;
