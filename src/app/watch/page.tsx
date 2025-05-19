import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { Watch } from "@/components/watch"

const page = () => {
  return (
    <div className="bg-black min-h-screen items-center justify-center p-6">
        <Link href={"/"} className="absolute top-5 left-5">
            <ArrowLeft className="text-white absolute top-5 left-5 w-8 h-8" />
        </Link>
        <h1 className="text-center text-3xl sm:text-5xl">Watch Stream</h1>
        <div className="flex items-center justify-center border border-white rounded-lg p-6 absolute mt-20 left-[25%] w-[50vw]">
          <Watch />
        </div>
    </div>
  )
}

export default page
