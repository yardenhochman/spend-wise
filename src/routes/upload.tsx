import { createFileRoute } from '@tanstack/react-router'
import FileUpload from '@/components/app/FileUpload'

export const Route = createFileRoute('/upload')({ component: UploadPage })

function UploadPage() {
  return (
    <div className="min-h-screen bg-page p-6">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-gray-100 mb-2">Import Data</h2>
        <p className="text-gray-60 mb-6">
          Upload a Leumi bank or credit card PDF statement, or an Interactive
          Brokers Flex Query XML export. SpendWise will route the file to the
          correct importer automatically.
        </p>
        <FileUpload />
      </div>
    </div>
  )
}
