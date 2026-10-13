import type { Message } from "./ai-message"

// ─── 포맷 헬퍼 ────────────────────────────────────────────────────────────────

function formatMessages(messages: Message[]): string {
  return messages
    .map((m) => {
      const role = m.role === "user" ? "사용자" : "AI 어시스턴트"
      const time = m.timestamp.toLocaleString("ko-KR")
      return `[${role}] ${time}\n${m.content}`
    })
    .join("\n\n---\n\n")
}

function getTitle(): string {
  return `대원정밀 MES AI 대화 기록 — ${new Date().toLocaleDateString("ko-KR")}`
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

export async function exportToPDF(messages: Message[]) {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })

  const pageW = doc.internal.pageSize.getWidth()
  const margin = 15
  const contentW = pageW - margin * 2
  let y = margin

  // 제목
  doc.setFontSize(14)
  doc.setFont("helvetica", "bold")
  doc.text(getTitle(), margin, y)
  y += 10

  // 구분선
  doc.setDrawColor(200)
  doc.line(margin, y, pageW - margin, y)
  y += 7

  doc.setFontSize(10)
  for (const msg of messages) {
    const role = msg.role === "user" ? "[사용자]" : "[AI 어시스턴트]"
    const time = msg.timestamp.toLocaleString("ko-KR")

    doc.setFont("helvetica", "bold")
    doc.text(`${role}  ${time}`, margin, y)
    y += 5

    doc.setFont("helvetica", "normal")
    const lines = doc.splitTextToSize(msg.content, contentW)
    for (const line of lines) {
      if (y > 275) {
        doc.addPage()
        y = margin
      }
      doc.text(line, margin, y)
      y += 5
    }
    y += 5

    if (y > 275) {
      doc.addPage()
      y = margin
    }
  }

  doc.save(`MES_AI_대화_${Date.now()}.pdf`)
}

// ─── Excel ────────────────────────────────────────────────────────────────────

export async function exportToExcel(messages: Message[]) {
  const XLSX = await import("xlsx")

  const rows = messages.map((m) => ({
    역할: m.role === "user" ? "사용자" : "AI 어시스턴트",
    시간: m.timestamp.toLocaleString("ko-KR"),
    내용: m.content,
  }))

  const ws = XLSX.utils.json_to_sheet(rows)
  ws["!cols"] = [{ wch: 14 }, { wch: 22 }, { wch: 80 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "AI 대화")
  XLSX.writeFile(wb, `MES_AI_대화_${Date.now()}.xlsx`)
}

// ─── Word (DOCX) ──────────────────────────────────────────────────────────────

export async function exportToWord(messages: Message[]) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await import("docx")

  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      text: getTitle(),
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 300 },
    }),
  ]

  for (const msg of messages) {
    const role = msg.role === "user" ? "사용자" : "AI 어시스턴트"
    const time = msg.timestamp.toLocaleString("ko-KR")

    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${role}`, bold: true, size: 22 }),
          new TextRun({ text: `  ${time}`, color: "888888", size: 18 }),
        ],
        spacing: { before: 200, after: 80 },
      }),
      new Paragraph({
        children: [new TextRun({ text: msg.content, size: 20 })],
        spacing: { after: 200 },
      })
    )
  }

  const doc = new Document({ sections: [{ properties: {}, children }] })
  const blob = await Packer.toBlob(doc)
  downloadBlob(blob, `MES_AI_대화_${Date.now()}.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
}

// ─── HWP (RTF 기반 — 한글에서 열기 가능) ──────────────────────────────────────

export function exportToHWP(messages: Message[]) {
  // HWP는 RTF 형식으로 저장 (한글 2010+ 에서 열기 가능)
  const escapeRTF = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\n/g, "\\par ")

  const lines = messages.map((msg) => {
    const role = msg.role === "user" ? "사용자" : "AI 어시스턴트"
    const time = msg.timestamp.toLocaleString("ko-KR")
    return (
      `{\\b ${escapeRTF(role)}} {\\cf1 ${escapeRTF(time)}}\\par ` +
      `${escapeRTF(msg.content)}\\par\\par `
    )
  })

  const rtf = [
    "{\\rtf1\\ansi\\ansicpg949\\deff0",
    "{\\fonttbl{\\f0\\fnil\\fcharset129 Malgun Gothic;}}",
    "{\\colortbl ;\\red136\\green136\\blue136;}",
    "\\f0\\fs22\\sl276\\slmult1",
    `{\\b\\fs28 ${escapeRTF(getTitle())}}\\par\\par `,
    ...lines,
    "}",
  ].join("\n")

  const blob = new Blob([rtf], { type: "application/rtf" })
  downloadBlob(blob, `MES_AI_대화_${Date.now()}.hwp`, "application/rtf")
}

// ─── 인쇄 ────────────────────────────────────────────────────────────────────

export function printMessages(messages: Message[]) {
  const content = messages
    .map((m) => {
      const role = m.role === "user" ? "사용자" : "AI 어시스턴트"
      const time = m.timestamp.toLocaleString("ko-KR")
      const bg = m.role === "user" ? "#EFF6FF" : "#F9FAFB"
      return `
        <div style="margin-bottom:16px;padding:12px 16px;background:${bg};border-radius:8px;">
          <div style="font-weight:600;font-size:12px;color:#666;margin-bottom:6px;">${role} · ${time}</div>
          <div style="font-size:14px;line-height:1.6;white-space:pre-wrap;">${m.content}</div>
        </div>`
    })
    .join("")

  const win = window.open("", "_blank")
  if (!win) return
  win.document.write(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8"/>
  <title>${getTitle()}</title>
  <style>
    @media print { body { -webkit-print-color-adjust: exact; } }
    body { font-family: 'Malgun Gothic', sans-serif; margin: 32px; color: #111; }
    h2 { font-size: 16px; border-bottom: 2px solid #ddd; padding-bottom: 8px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <h2>${getTitle()}</h2>
  ${content}
</body>
</html>`)
  win.document.close()
  win.focus()
  setTimeout(() => { win.print(); win.close() }, 300)
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string, type: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a) }, 100)
}
