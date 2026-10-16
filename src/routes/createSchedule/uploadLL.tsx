import { ArrowLeft, Edit2, RefreshCw, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLearner, useUploadLLMutation } from "@/queries/learner";

export default function UploadLL() {
  const { data: learner } = useLearner();
  const licenceName = learner?.has_a_DL
    ? "Driving Licence (DL)"
    : "Learner's Licence (LL)";
  const [file, setFile] = useState<File | undefined>(undefined);
  const [fileName, setFileName] = useState<string>("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { mutate, isPending, error } = useUploadLLMutation();
  const navigate = useNavigate();

  useEffect(() => {
    if (file && file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setPreviewUrl(null);
    }
  }, [file]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setFileName(selectedFile.name);
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (file && !isPending) {
      mutate(
        { file },
        {
          onSuccess: () => {
            navigate("/createSchedule/preferences?type=new");
          },
        },
      );
    }
  };

  return (
    <div className="flex h-full w-full flex-col rounded-md">
      <div className="flex flex-col rounded-b-[40px] bg-primary">
        <div className="flex items-center justify-between p-4">
          <Button
            variant="ghost"
            size="icon"
            className="text-primary-foreground"
          >
            <Link to="/createSchedule/onboardingQuestions">
              <ArrowLeft className="h-6 w-6" />
            </Link>
          </Button>
          <span className="text-lg font-semibold text-primary-foreground">
            3/4
          </span>
        </div>
        <div className="relative z-10 rounded-b-[40px] bg-primary p-6 text-primary-foreground">
          <h1 className="mb-1 text-xl font-semibold">
            Upload your {licenceName}
          </h1>
          <p className="">Required for government compliance</p>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-1 flex-col">
        <div className="scrollbar-hide mx-auto mt-8 flex w-full max-w-96 flex-1 flex-col items-center gap-10 overflow-y-auto bg-white p-4">
          <div className="w-full space-y-4">
            {file ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border-2 border-gray-300 p-4">
                <div className="relative flex h-full w-full justify-center">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Preview"
                      className="h-40 max-w-full rounded"
                    />
                  ) : (
                    <div className="flex h-40 w-full items-center justify-center rounded bg-gray-200">
                      <span className="text-gray-500">
                        No preview available
                      </span>
                    </div>
                  )}
                  {/* <Button
                  variant={"ghost"}
                  size={"icon"}
                  className="absolute right-2 top-0"
                >
                  <X />
                </Button> */}
                </div>
                <div className="flex w-full items-center justify-between">
                  {isEditingName ? (
                    <Input
                      value={fileName}
                      onChange={(e) => setFileName(e.target.value)}
                      onBlur={() => setIsEditingName(false)}
                      className="mr-2 flex-grow"
                    />
                  ) : (
                    <span className="mr-2 flex-grow truncate">{fileName}</span>
                  )}
                  <div className="flex-shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setIsEditingName(!isEditingName)}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Label htmlFor="replace-file" className="cursor-pointer">
                      <Button type="button" variant="ghost" size="icon" asChild>
                        <span>
                          <RefreshCw className="h-4 w-4" />
                        </span>
                      </Button>
                      <input
                        id="replace-file"
                        type="file"
                        className="sr-only"
                        accept=".jpeg,.jpg,.pdf,.png"
                        onChange={handleFileChange}
                      />
                    </Label>
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-gray-300 p-4 hover:bg-gray-100"
                onClick={() => document.getElementById("file-upload")?.click()}
              >
                <Upload className="h-12 w-12 text-gray-400" />
                <span className="text-lg font-medium">Upload your licence</span>
                <input
                  id="file-upload"
                  type="file"
                  className="sr-only"
                  accept=".jpeg,.jpg,.pdf,.png"
                  onChange={handleFileChange}
                />
                <p className="text-xs text-muted-foreground">
                  JPEG, PNG or PDF (4 MB max)
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="sticky bottom-0 border-t bg-white p-4">
          {error && (
            <p role="alert" className="mb-3 text-sm text-red-600">
              {error.message || "Upload failed. Please try again."}
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={isPending || !file}
          >
            {isPending ? "Uploading..." : "Upload and select slots"}
          </Button>
        </div>
      </form>
    </div>
  );
}
