import { useState, useCallback } from 'react'
import { Upload, CheckCircle, AlertCircle } from 'lucide-react'
import { importFile } from '@/lib/api'
import type { ImportResult } from '@/lib/types'
import { Card, CardContent } from '@/components/ui/card'

export default function FileUpload({
  onComplete,
}: {
  onComplete?: (result: ImportResult) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback(
    async (file: File) => {
      setUploading(true)
      setResult(null)
      setError(null)

      try {
        const res = await importFile(file)
        setResult(res)
        onComplete?.(res)
      } catch (err: any) {
        setError(err.message || 'Upload failed')
      } finally {
        setUploading(false)
      }
    },
    [onComplete],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  const onFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  const isInvestmentImport = result?.parser_used === 'ibkr-flex'

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-[18px] p-12 text-center transition-colors cursor-pointer bg-surface
          ${dragOver ? 'border-brand bg-brand/5' : 'border-gray-20 hover:border-gray-40'}
          ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        <input
          id="file-input"
          type="file"
          accept=".pdf,.xml"
          onChange={onFileInput}
          className="hidden"
        />
        <Upload className="mx-auto mb-4 text-gray-40" size={48} />
        <p className="text-lg text-gray-80 mb-2">
          {uploading ? 'Parsing file...' : 'Drop a Leumi PDF or IBKR XML here'}
        </p>
        <p className="text-sm text-gray-40">
          Bank statement PDF or Interactive Brokers Flex Query XML
        </p>
      </div>

      {result && (
        <Card className="border-gray-10 shadow-sm">
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center gap-2 text-positive">
              <CheckCircle size={20} />
              <span className="font-bold">Import Complete</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-gray-40">Parser</p>
                <p className="text-gray-100 font-medium">
                  {result.parser_used}
                </p>
              </div>
              <div>
                <p className="text-gray-40">Parsed</p>
                <p className="text-gray-100 font-medium">
                  {result.parsed_count}
                </p>
              </div>
              <div>
                <p className="text-gray-40">Inserted</p>
                <p className="text-gray-100 font-medium">
                  {result.inserted_count}
                </p>
              </div>
              <div>
                <p className="text-gray-40">
                  {isInvestmentImport
                    ? 'Snapshots Replaced'
                    : 'Duplicates Skipped'}
                </p>
                <p className="text-gray-100 font-medium">
                  {isInvestmentImport
                    ? (result.replaced_count ?? 0)
                    : result.deduped_count}
                </p>
              </div>
            </div>
            {result.unparsed_count > 0 && (
              <p className="text-cat-dining text-sm">
                {result.unparsed_count} lines could not be parsed (check server
                logs)
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-negative/20 bg-negative/5">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertCircle className="text-negative shrink-0" size={20} />
            <p className="text-negative">{error}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
