export function toVectorLiteral(values: number[]) {
  // pgvector input syntax: [1,2,3]
  // keep a reasonable precision to control payload size
  const parts = values.map((v) => {
    if (Number.isFinite(v)) return v.toFixed(6)
    return "0.000000"
  })
  return `[${parts.join(",")}]`
}
