// Template chạy lại mỗi lần chuyển trang: nội dung trang hiện vào nhẹ nhàng, đầu và chân trang đứng yên.
export default function AdminTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
