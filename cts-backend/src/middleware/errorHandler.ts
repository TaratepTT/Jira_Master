import { Request, Response, NextFunction } from 'express'
import multer from 'multer'

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('[error]', err)
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') { res.status(400).json({ message: 'ไฟล์ใหญ่เกิน 20 MB' }); return }
    res.status(400).json({ message: err.message }); return
  }
  if (err instanceof Error) { res.status(400).json({ message: err.message }); return }
  res.status(500).json({ message: 'Internal server error' })
}
