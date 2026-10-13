import { z } from "zod"

export const CONNECTION_PROTOCOL_OPTIONS = [
  { label: "Modbus TCP",    value: "MODBUS_TCP" },
  { label: "OPC-UA",        value: "OPC_UA" },
  { label: "MQTT",          value: "MQTT" },
  { label: "MC Protocol",   value: "MC_PROTOCOL" },
  { label: "Siemens S7",    value: "S7" },
  { label: "FOCAS",         value: "FOCAS" },
  { label: "Custom",        value: "CUSTOM" },
] as const

export const connectionFormSchema = z.object({
  equipmentId: z.string().min(1, "설비를 선택하세요"),
  gatewayId:   z.string().min(1, "게이트웨이를 선택하세요"),
  protocol:    z.enum(["MODBUS_TCP", "OPC_UA", "MQTT", "MC_PROTOCOL", "S7", "FOCAS", "CUSTOM", "NCWATCH_AGENT"], {
    required_error: "프로토콜을 선택하세요",
  }),
  host: z.string().max(255).optional().nullable(),
  port: z.coerce.number().int().min(1).max(65535).optional().nullable(),
  // Modbus TCP fields
  slaveId:        z.coerce.number().int().optional().nullable(),
  registerStart:  z.coerce.number().int().optional().nullable(),
  registerCount:  z.coerce.number().int().optional().nullable(),
  // OPC-UA fields
  endpointUrl: z.string().max(500).optional().nullable(),
  namespace:   z.string().max(255).optional().nullable(),
  // MC Protocol fields
  stationNo: z.coerce.number().int().optional().nullable(),
  networkNo:  z.coerce.number().int().optional().nullable(),
})

export type ConnectionFormValues = z.infer<typeof connectionFormSchema>
