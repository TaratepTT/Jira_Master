import multer from 'multer'
import { Request } from 'express'

const ALLOWED_MIME = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream', // some OS send xlsx as this
])

const ALLOWED_EXT = /\.(csv|xlsx|xls)$/i

const storage = multer.memoryStorage()

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const okMime = ALLOWED_MIME.has(file.mimetype)
  const okExt  = ALLOWED_EXT.test(file.originalname)
  if (okMime || okExt) {
    cb(null, true)
  } else {
    cb(new Error('รองรับเฉพาะไฟล์ .csv, .xlsx, .xls เท่านั้น'))
  }
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
})
