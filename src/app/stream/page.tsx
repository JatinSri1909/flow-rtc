import { ArrowLeft, ArrowUpRightFromSquare } from "lucide-react"
import Link from "next/link"
import { Stream } from "@/components/stream" 

const page = () => {
  return (
    <div className="bg-black min-h-screen items-center justify-center p-6">
        <Link href={"/"} className="absolute top-5 left-5">
            <ArrowLeft className="text-white absolute top-5 left-5 w-8 h-8" />
        </Link>
        <h1 className="text-center text-3xl sm:text-5xl mb-20">Live Stream</h1>
        <div className="flex items-center justify-center gap-6 border border-white rounded-lg p-6">
          <Stream />
        </div>

        <Link href={"/watch"} className="absolute top-5 right-5 mt-5">
          <u className="flex items-center gap-2">
            <ArrowUpRightFromSquare className="text-white w-6 h-6" />
            Watch Streaming
          </u>
        </Link>
    </div>
  )
}

export default page
