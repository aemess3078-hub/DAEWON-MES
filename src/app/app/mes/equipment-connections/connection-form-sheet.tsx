"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"

import { Form } from "@/components/ui/form"
import {
  FormSheet,
  FormTextField,
  FormSelectField,
  FormNumberField,
} from "@/components/common/form-sheet"
import {
  connectionFormSchema,
  ConnectionFormValues,
  CONNECTION_PROTOCOL_OPTIONS,
} from "./connection-form-schema"
import {
  createConnection,
  updateConnection,
  EquipmentConnectionRow,
} from "@/lib/actions/equipment-integration.actions"
import { ConnectionProtocol, Prisma } from "@prisma/client"

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConnectionFormSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingRow: EquipmentConnectionRow | null
  equipments: { id: string; code: string; name: string; workCenter: { name: string } }[]
  gateways: { id: string; name: string; status: string }[]
}

const DEFAULT_VALUES: ConnectionFormValues = {
  equipmentId: "",
  gatewayId: "",
  protocol: "MODBUS_TCP",
  host: "",
  port: null,
  slaveId: null,
  registerStart: null,
  registerCount: null,
  endpointUrl: "",
  namespace: "",
  stationNo: null,
  networkNo: null,
}

function buildConfig(values: ConnectionFormValues): Prisma.InputJsonValue | null {
  switch (values.protocol) {
    case "MODBUS_TCP":
      return {
        slaveId: values.slaveId ?? 1,
        registerStart: values.registerStart ?? 0,
        registerCount: values.registerCount ?? 10,
      }
    case "OPC_UA":
      return {
        endpointUrl: values.endpointUrl ?? "",
        namespace: values.namespace ?? "",
      }
    case "MC_PROTOCOL":
      return {
        stationNo: values.stationNo ?? 0,
        networkNo: values.networkNo ?? 0,
      }
    default:
      return null
  }
}

function parseConfig(protocol: ConnectionProtocol, config: any): Partial<ConnectionFormValues> {
  if (!config) return {}
  switch (protocol) {
    case "MODBUS_TCP":
      return {
        slaveId: config.slaveId ?? null,
        registerStart: config.registerStart ?? null,
        registerCount: config.registerCount ?? null,
      }
    case "OPC_UA":
      return {
        endpointUrl: config.endpointUrl ?? "",
        namespace: config.namespace ?? "",
      }
    case "MC_PROTOCOL":
      return {
        stationNo: config.stationNo ?? null,
        networkNo: config.networkNo ?? null,
      }
    default:
      return {}
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConnectionFormSheet({
  open,
  onOpenChange,
  editingRow,
  equipments,
  gateways,
}: ConnectionFormSheetProps) {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const form = useForm<ConnectionFormValues>({
    resolver: zodResolver(connectionFormSchema),
    defaultValues: DEFAULT_VALUES,
  })

  const watchedProtocol = form.watch("protocol")

  useEffect(() => {
    if (open) {
      if (editingRow) {
        form.reset({
          ...DEFAULT_VALUES,
          equipmentId: editingRow.equipmentId,
          gatewayId: editingRow.gatewayId,
          protocol: editingRow.protocol,
          host: editingRow.host ?? "",
          port: editingRow.port ?? null,
          ...parseConfig(editingRow.protocol, editingRow.config),
        })
      } else {
        form.reset(DEFAULT_VALUES)
      }
    }
  }, [open, editingRow]) // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(values: ConnectionFormValues) {
    setIsLoading(true)
    try {
      const config = buildConfig(values)
      if (editingRow) {
        await updateConnection(editingRow.id, {
          protocol: values.protocol,
          host: values.host || null,
          port: values.port || null,
          config: config ?? undefined,
        })
      } else {
        await createConnection({
          equipmentId: values.equipmentId,
          gatewayId: values.gatewayId,
          protocol: values.protocol,
          host: values.host || null,
          port: values.port || null,
          config: config ?? null,
        })
      }
      onOpenChange(false)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "저장 중 오류가 발생했습니다.")
    } finally {
      setIsLoading(false)
    }
  }

  const isEdit = !!editingRow

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      mode={isEdit ? "edit" : "create"}
      title={isEdit ? "설비 연결 수정" : "설비 연결 등록"}
      description={
        isEdit
          ? "설비 연결 설정을 수정합니다."
          : "설비와 게이트웨이 간의 통신 연결을 설정합니다."
      }
      isLoading={isLoading}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <Form {...form}>
        <div className="space-y-4">
          <FormSelectField
            control={form.control}
            name="equipmentId"
            label="설비"
            placeholder="설비 선택"
            disabled={isEdit}
            options={equipments.map((e) => ({
              label: `${e.name} (${e.code}) — ${e.workCenter.name}`,
              value: e.id,
            }))}
          />
          <FormSelectField
            control={form.control}
            name="gatewayId"
            label="게이트웨이"
            placeholder="게이트웨이 선택"
            disabled={isEdit}
            options={gateways.map((g) => ({
              label: g.name,
              value: g.id,
            }))}
          />
          <FormSelectField
            control={form.control}
            name="protocol"
            label="프로토콜"
            placeholder="프로토콜 선택"
            options={CONNECTION_PROTOCOL_OPTIONS.map((o) => ({
              label: o.label,
              value: o.value,
            }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <FormTextField
              control={form.control}
              name="host"
              label="호스트 (IP)"
              placeholder="예: 192.168.1.10"
            />
            <FormNumberField
              control={form.control}
              name="port"
              label="포트"
              placeholder="예: 502"
              min={1}
              max={65535}
            />
          </div>

          {/* Modbus TCP 전용 필드 */}
          {watchedProtocol === "MODBUS_TCP" && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-3">
              <p className="text-[13px] font-medium text-muted-foreground">Modbus TCP 설정</p>
              <div className="grid grid-cols-3 gap-3">
                <FormNumberField
                  control={form.control}
                  name="slaveId"
                  label="Slave ID"
                  placeholder="1"
                  min={0}
                  max={255}
                />
                <FormNumberField
                  control={form.control}
                  name="registerStart"
                  label="Register Start"
                  placeholder="0"
                  min={0}
                />
                <FormNumberField
                  control={form.control}
                  name="registerCount"
                  label="Register Count"
                  placeholder="10"
                  min={1}
                />
              </div>
            </div>
          )}

          {/* OPC-UA 전용 필드 */}
          {watchedProtocol === "OPC_UA" && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-3">
              <p className="text-[13px] font-medium text-muted-foreground">OPC-UA 설정</p>
              <FormTextField
                control={form.control}
                name="endpointUrl"
                label="Endpoint URL"
                placeholder="opc.tcp://..."
              />
              <FormTextField
                control={form.control}
                name="namespace"
                label="Namespace"
                placeholder="예: urn:machine:server"
              />
            </div>
          )}

          {/* MC Protocol 전용 필드 */}
          {watchedProtocol === "MC_PROTOCOL" && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-3">
              <p className="text-[13px] font-medium text-muted-foreground">MC Protocol 설정</p>
              <div className="grid grid-cols-2 gap-3">
                <FormNumberField
                  control={form.control}
                  name="stationNo"
                  label="Station No."
                  placeholder="0"
                  min={0}
                />
                <FormNumberField
                  control={form.control}
                  name="networkNo"
                  label="Network No."
                  placeholder="0"
                  min={0}
                />
              </div>
            </div>
          )}
        </div>
      </Form>
    </FormSheet>
  )
}
