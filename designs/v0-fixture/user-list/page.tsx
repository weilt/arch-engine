export default function UserListPage() {
  return (
    <main data-region="main">
      <div data-component="PageHeader">用户列表</div>
      <table>
        <thead>
          <tr>
            <th>姓名</th>
            <th>邮箱</th>
          </tr>
        </thead>
        <tbody>{/* rows */}</tbody>
      </table>
      <div data-component="EmptyState">暂无用户</div>
      <button data-component="PrimaryButton">新建用户</button>
    </main>
  );
}
