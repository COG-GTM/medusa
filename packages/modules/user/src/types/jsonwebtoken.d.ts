declare module "jsonwebtoken/lib/timespan" {
  export default function timespan(
    time: string | number,
    iat?: number
  ): number
}
